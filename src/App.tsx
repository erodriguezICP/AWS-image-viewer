import { useEffect, useMemo, useRef, useState } from "react";
import { getUrl, list } from "aws-amplify/storage";
import "./App.css";

type ArchiveImage = { path:string; name:string; collection:string; category:string; folder:string; size?:number; lastModified?:Date };
type CachedUrl = { url:string; expiresAt:number };
type PageImage = ArchiveImage & { url?:string; failed?:boolean };

const ARCHIVE_PATH = "Key Manifest/";
const S3_BUCKET = { bucketName:"manifest-inventory", region:"us-east-1" };
const PAGE_SIZE = 16;
const CONCURRENCY = 8;
const URL_TTL_SECONDS = 3600;
const URL_SAFETY_MS = 60000;
const REQUEST_TIMEOUT_MS = 12000;
const ALL_COLLECTIONS = "All collections";
const ALL_CATEGORIES = "All categories";
const UNCATEGORIZED = "Uncategorized";
const IMAGE_FILE = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;
const BROWSER_IMAGE = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

function relativeParts(path:string):string[] {
  const value = path.startsWith(ARCHIVE_PATH) ? path.slice(ARCHIVE_PATH.length) : path;
  return value.split("/").filter(Boolean);
}

function toArchiveImage(item:{path:string;size?:number;lastModified?:Date}):ArchiveImage {
  const parts = relativeParts(item.path);
  const folders = parts.slice(0,-1);
  return {
    path:item.path,
    name:parts.length ? parts[parts.length-1] : item.path,
    collection:folders.length > 0 ? folders[0] : UNCATEGORIZED,
    category:folders.length > 1 ? folders[1] : UNCATEGORIZED,
    folder:folders.length ? folders.join(" / ") : UNCATEGORIZED,
    size:item.size,
    lastModified:item.lastModified,
  };
}

function formatBytes(bytes?:number):string {
  if (bytes === undefined) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1048576).toFixed(1)} MB`;
}

function withTimeout<T>(promise:Promise<T>, ms:number):Promise<T> {
  return new Promise<T>((resolve,reject) => {
    const timer = window.setTimeout(() => reject(new Error("Request timed out")), ms);
    promise.then(
      value => { window.clearTimeout(timer); resolve(value); },
      error => { window.clearTimeout(timer); reject(error); },
    );
  });
}

export default function App() {
  const [images,setImages] = useState<ArchiveImage[]>([]);
  const [pageImages,setPageImages] = useState<PageImage[]>([]);
  const [search,setSearch] = useState("");
  const [collection,setCollection] = useState(ALL_COLLECTIONS);
  const [category,setCategory] = useState(ALL_CATEGORIES);
  const [page,setPage] = useState(1);
  const [selected,setSelected] = useState<PageImage|null>(null);
  const [loadingArchive,setLoadingArchive] = useState(true);
  const [loadingPage,setLoadingPage] = useState(false);
  const [downloading,setDownloading] = useState(false);
  const [error,setError] = useState("");
  const [warning,setWarning] = useState("");
  const cache = useRef<Map<string,CachedUrl>>(new Map());
  const pending = useRef<Map<string,Promise<string>>>(new Map());

  async function imageUrl(path:string):Promise<string> {
    const now = Date.now();
    const hit = cache.current.get(path);
    if (hit && hit.expiresAt > now + URL_SAFETY_MS) return hit.url;
    if (hit) cache.current.delete(path);
    const existing = pending.current.get(path);
    if (existing) return existing;

    const request = withTimeout(getUrl({path,options:{bucket:S3_BUCKET,expiresIn:URL_TTL_SECONDS}}),REQUEST_TIMEOUT_MS)
      .then(result => {
        const url = result.url.toString();
        cache.current.set(path,{url,expiresAt:Date.now()+URL_TTL_SECONDS*1000});
        return url;
      })
      .finally(() => pending.current.delete(path));
    pending.current.set(path,request);
    return request;
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoadingArchive(true); setError("");
        const result = await list({path:ARCHIVE_PATH,options:{listAll:true,bucket:S3_BUCKET}});
        if (!active) return;
        setImages(result.items.filter(item => IMAGE_FILE.test(item.path)).map(toArchiveImage).sort((a,b) =>
          a.collection.localeCompare(b.collection,undefined,{numeric:true,sensitivity:"base"}) ||
          a.category.localeCompare(b.category,undefined,{numeric:true,sensitivity:"base"}) ||
          a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:"base"})
        ));
      } catch (reason) {
        console.error(reason);
        if (active) setError(`Unable to load ${S3_BUCKET.bucketName}/${ARCHIVE_PATH}. Check access and Storage permissions.`);
      } finally { if (active) setLoadingArchive(false); }
    })();
    return () => { active=false; };
  },[]);

  const collections = useMemo(() => Array.from(new Set(images.map(x=>x.collection))).sort(),[images]);
  const categories = useMemo(() => Array.from(new Set((collection===ALL_COLLECTIONS?images:images.filter(x=>x.collection===collection)).map(x=>x.category))).sort(),[images,collection]);
  const filtered = useMemo(() => {
    const q=search.trim().toLowerCase();
    return images.filter(x =>
      (collection===ALL_COLLECTIONS || x.collection===collection) &&
      (category===ALL_CATEGORIES || x.category===category) &&
      (!q || [x.name,x.collection,x.category,x.folder,x.path].join(" ").toLowerCase().includes(q))
    );
  },[images,search,collection,category]);
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const current=useMemo(() => filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[filtered,page]);

  useEffect(() => { setPage(1); setSelected(null); },[search,collection,category]);
  useEffect(() => { setCategory(ALL_CATEGORIES); },[collection]);
  useEffect(() => { if(page>totalPages) setPage(totalPages); },[page,totalPages]);

  useEffect(() => {
    let active=true;
    setSelected(null); setWarning("");
    setPageImages(current.map(image=>({...image})));
    if (!current.length) { setLoadingPage(false); return () => {active=false;}; }
    setLoadingPage(true);
    let next=0, completed=0, failures=0;

    async function worker():Promise<void> {
      while(active && next<current.length) {
        const index=next++;
        try {
          const url=await imageUrl(current[index].path);
          if(active) setPageImages(previous => previous.map((item,i)=>i===index?{...item,url}:item));
        } catch(reason) {
          failures++; console.error(reason);
          if(active) setPageImages(previous => previous.map((item,i)=>i===index?{...item,failed:true}:item));
        } finally {
          completed++;
          if(active && completed===current.length) {
            setLoadingPage(false);
            if(failures) setWarning(`${failures} image${failures===1?"":"s"} could not be loaded.`);
          }
        }
      }
    }
    void Promise.all(Array.from({length:Math.min(CONCURRENCY,current.length)},()=>worker()));
    return () => { active=false; };
  },[current]);

  async function downloadImage(image:PageImage):Promise<void> {
    try {
      setDownloading(true); setWarning("");
      const response=await fetch(await imageUrl(image.path));
      if(!response.ok) throw new Error(String(response.status));
      const objectUrl=URL.createObjectURL(await response.blob());
      const link=document.createElement("a"); link.href=objectUrl; link.download=image.name; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
    } catch(reason) { console.error(reason); window.open(await imageUrl(image.path),"_blank","noopener,noreferrer"); }
    finally { setDownloading(false); }
  }

  function changePage(value:number):void { setPage(Math.max(1,Math.min(value,totalPages))); window.scrollTo({top:0,behavior:"smooth"}); }
  function clearFilters():void { setSearch(""); setCollection(ALL_COLLECTIONS); setCategory(ALL_CATEGORIES); setPage(1); }
  const first=filtered.length?(page-1)*PAGE_SIZE+1:0;
  const last=Math.min(page*PAGE_SIZE,filtered.length);

  return <div className="archive-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">ICP</div><div><strong>Image Archive</strong><span>Digital Collection</span></div></div>
      <div className="static-filters">
        <label htmlFor="archive-search">Search archive</label><input id="archive-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filename, folder, collection..." />
        <label htmlFor="collection-filter">Collection</label><select id="collection-filter" value={collection} onChange={e=>setCollection(e.target.value)}><option>{ALL_COLLECTIONS}</option>{collections.map(value=><option key={value}>{value}</option>)}</select>
        <label htmlFor="category-filter">Category</label><select id="category-filter" value={category} onChange={e=>setCategory(e.target.value)}><option>{ALL_CATEGORIES}</option>{categories.map(value=><option key={value}>{value}</option>)}</select>
        <button className="clear-button" onClick={clearFilters}>Clear filters</button><div className="result-count"><span>Results</span><strong>{filtered.length.toLocaleString()}</strong></div>
      </div>
    </aside>
    <main className="main-content">
      <header className="top-header"><div><h1>Image Archive</h1><p>People. Photographs. A brighter tomorrow.</p></div></header>
      {loadingArchive?<div className="status"><div className="spinner"/><strong>Loading archive...</strong></div>:error?<div className="status error"><strong>Archive unavailable</strong><p>{error}</p></div>:
      <div className={selected?"content-layout details-open":"content-layout"}><section className="results-area">
        <div className="results-toolbar"><div className="results-summary"><strong>{filtered.length.toLocaleString()} results</strong><span>Showing {first} to {last}</span></div><nav className="pagination"><button onClick={()=>changePage(page-1)} disabled={page===1}>Previous</button><span>Page <strong>{page}</strong> of <strong>{totalPages}</strong></span><button onClick={()=>changePage(page+1)} disabled={page===totalPages}>Next</button></nav></div>
        {warning&&<div className="warning">{warning}</div>}
        {!filtered.length?<div className="status"><strong>No images found</strong></div>:<div className="image-grid">{pageImages.map((image,index)=><button key={image.path} className={selected?.path===image.path?"image-card selected":"image-card"} onClick={()=>image.url&&setSelected(image)} disabled={!image.url}>
          <div className="thumbnail">{image.url&&BROWSER_IMAGE.test(image.path)?<img src={image.url} alt={image.name} loading={index<4?"eager":"lazy"} decoding="async" fetchPriority={index<4?"high":"auto"}/>:image.failed?<div className="no-preview">Unavailable</div>:<div className="thumbnail-skeleton"/>}</div>
          <div className="card-details"><strong>{image.name}</strong><span>{image.collection}</span><span>{image.category}</span><small>{image.lastModified?image.lastModified.toLocaleDateString():"Date unavailable"}</small></div>
        </button>)}</div>}
        <nav className="bottom-pagination"><button onClick={()=>changePage(page-1)} disabled={page===1}>Previous</button><span>{loadingPage?"Loading images...":`Page ${page} of ${totalPages}`}</span><button onClick={()=>changePage(page+1)} disabled={page===totalPages}>Next</button></nav>
      </section>
      {selected&&<aside className="details-panel"><div className="details-header"><strong>{selected.name}</strong><button onClick={()=>setSelected(null)}>x</button></div><div className="details-preview"><img src={selected.url} alt={selected.name}/></div><div className="details-actions"><button className="download-button" disabled={downloading} onClick={()=>void downloadImage(selected)}>{downloading?"Downloading...":"Download"}</button><a href={selected.url} target="_blank" rel="noreferrer">Open original</a></div><dl className="metadata"><div><dt>Filename</dt><dd>{selected.name}</dd></div><div><dt>Collection</dt><dd>{selected.collection}</dd></div><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Folder</dt><dd>{selected.folder}</dd></div><div><dt>File size</dt><dd>{formatBytes(selected.size)}</dd></div></dl></aside>}
      </div>}
    </main>
  </div>;
}
