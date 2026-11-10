import { useEffect, useMemo, useRef, useState } from "react";
import { getUrl, list } from "aws-amplify/storage";
import "./App.css";

type ArchiveImage = { path:string; name:string; collection:string; category:string; folder:string; size?:number; lastModified?:Date };
type DisplayImage = ArchiveImage & { url?:string; failed?:boolean };
type CachedUrl = { url:string; expiresAt:number };

const ARCHIVE_PATH = "Key Manifest/";
const S3_BUCKET = { bucketName:"manifest-inventory", region:"us-east-1" };
const PAGE_SIZE = 12;
const METADATA_BATCH_SIZE = 1000;
const URL_CONCURRENCY = 8;
const URL_TIMEOUT_MS = 12_000;
const URL_EXPIRATION_SECONDS = 3600;
const URL_CACHE_SAFETY_MS = 60_000;
const ALL_COLLECTIONS = "All collections";
const ALL_CATEGORIES = "All categories";
const UNCATEGORIZED = "Uncategorized";
const IMAGE_FILE = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;
const BROWSER_IMAGE = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

function partsFor(path:string):string[]{
  const value=path.startsWith(ARCHIVE_PATH)?path.slice(ARCHIVE_PATH.length):path;
  return value.split("/").filter(Boolean);
}
function toArchiveImage(item:{path:string;size?:number;lastModified?:Date}):ArchiveImage{
  const parts=partsFor(item.path); const folders=parts.slice(0,-1);
  return {path:item.path,name:parts.length?parts[parts.length-1]:item.path,collection:folders.length?folders[0]:UNCATEGORIZED,category:folders.length>1?folders[1]:UNCATEGORIZED,folder:folders.length?folders.join(" / "):UNCATEGORIZED,size:item.size,lastModified:item.lastModified};
}
function formatBytes(bytes?:number):string{
  if(bytes===undefined)return "Unknown"; if(bytes<1024)return `${bytes} B`; if(bytes<1048576)return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1048576).toFixed(1)} MB`;
}
function withTimeout<T>(promise:Promise<T>,ms:number):Promise<T>{
  return new Promise<T>((resolve,reject)=>{const timer=window.setTimeout(()=>reject(new Error("Request timed out")),ms);promise.then(v=>{window.clearTimeout(timer);resolve(v);},e=>{window.clearTimeout(timer);reject(e);});});
}

export default function App(){
  const [images,setImages]=useState<ArchiveImage[]>([]);
  const [pageImages,setPageImages]=useState<DisplayImage[]>([]);
  const [search,setSearch]=useState("");
  const [collection,setCollection]=useState(ALL_COLLECTIONS);
  const [category,setCategory]=useState(ALL_CATEGORIES);
  const [page,setPage]=useState(1);
  const [selected,setSelected]=useState<DisplayImage|null>(null);
  const [loadingInitialBatch,setLoadingInitialBatch]=useState(true);
  const [showLoadingScreen,setShowLoadingScreen]=useState(true);
  const [indexingArchive,setIndexingArchive]=useState(false);
  const [loadingPage,setLoadingPage]=useState(false);
  const [downloading,setDownloading]=useState(false);
  const [error,setError]=useState("");
  const [warning,setWarning]=useState("");
  const cache=useRef<Map<string,CachedUrl>>(new Map());
  const pending=useRef<Map<string,Promise<string>>>(new Map());

  async function imageUrl(path:string):Promise<string>{
    const now=Date.now(); const hit=cache.current.get(path);
    if(hit&&hit.expiresAt>now+URL_CACHE_SAFETY_MS)return hit.url;
    const existing=pending.current.get(path); if(existing)return existing;
    const request=withTimeout(getUrl({path,options:{bucket:S3_BUCKET,expiresIn:URL_EXPIRATION_SECONDS}}),URL_TIMEOUT_MS).then(result=>{const url=result.url.toString();cache.current.set(path,{url,expiresAt:Date.now()+URL_EXPIRATION_SECONDS*1000});return url;}).finally(()=>pending.current.delete(path));
    pending.current.set(path,request); return request;
  }

  useEffect(()=>{let active=true;(async()=>{let nextToken:string|undefined;let first=true;try{setError("");do{const result=await list({path:ARCHIVE_PATH,options:{bucket:S3_BUCKET,pageSize:METADATA_BATCH_SIZE,nextToken}});if(!active)return;const batch=result.items.filter(item=>IMAGE_FILE.test(item.path)).map(toArchiveImage);setImages(previous=>[...previous,...batch]);nextToken=result.nextToken;if(first){first=false;setLoadingInitialBatch(false);setIndexingArchive(Boolean(nextToken));}await new Promise<void>(resolve=>window.setTimeout(resolve,0));}while(active&&nextToken);if(active)setIndexingArchive(false);}catch(reason){console.error(reason);if(active)setError(`Unable to load images from "${S3_BUCKET.bucketName}/${ARCHIVE_PATH}".`);}finally{if(active)setLoadingInitialBatch(false);}})();return()=>{active=false;};},[]);
  useEffect(()=>{if((!loadingInitialBatch&&images.length>0)||error){const timer=window.setTimeout(()=>setShowLoadingScreen(false),250);return()=>window.clearTimeout(timer);}return undefined;},[loadingInitialBatch,images.length,error]);

  const collections=useMemo(()=>Array.from(new Set(images.map(x=>x.collection))).sort(),[images]);
  const categories=useMemo(()=>Array.from(new Set((collection===ALL_COLLECTIONS?images:images.filter(x=>x.collection===collection)).map(x=>x.category))).sort(),[images,collection]);
  const filtered=useMemo(()=>{const query=search.trim().toLowerCase();return images.filter(x=>(collection===ALL_COLLECTIONS||x.collection===collection)&&(category===ALL_CATEGORIES||x.category===category)&&(!query||[x.name,x.collection,x.category,x.folder,x.path].join(" ").toLowerCase().includes(query)));},[images,search,collection,category]);
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const current=useMemo(()=>filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[filtered,page]);
  useEffect(()=>{setPage(1);setSelected(null);},[search,collection,category]);
  useEffect(()=>{setCategory(ALL_CATEGORIES);},[collection]);
  useEffect(()=>{if(page>totalPages)setPage(totalPages);},[page,totalPages]);

  useEffect(()=>{let active=true;let next=0,completed=0,failures=0;setSelected(null);setWarning("");setPageImages(current.map(x=>({...x})));if(!current.length){setLoadingPage(false);return()=>{active=false;};}setLoadingPage(true);async function worker(){while(active&&next<current.length){const index=next++;try{const url=await imageUrl(current[index].path);if(active)setPageImages(previous=>previous.map((x,i)=>i===index?{...x,url}:x));}catch(reason){failures++;console.error(reason);if(active)setPageImages(previous=>previous.map((x,i)=>i===index?{...x,failed:true}:x));}finally{completed++;if(active&&completed===current.length){setLoadingPage(false);if(failures)setWarning(`${failures} image${failures===1?"":"s"} could not be loaded.`);}}}}void Promise.all(Array.from({length:Math.min(URL_CONCURRENCY,current.length)},()=>worker()));return()=>{active=false;};},[current]);

  function changePage(value:number){setPage(Math.max(1,Math.min(value,totalPages)));setSelected(null);window.scrollTo({top:0,behavior:"smooth"});}
  function clearFilters(){setSearch("");setCollection(ALL_COLLECTIONS);setCategory(ALL_CATEGORIES);setPage(1);setSelected(null);}
  async function downloadImage(image:DisplayImage){try{setDownloading(true);const response=await fetch(await imageUrl(image.path));if(!response.ok)throw new Error(String(response.status));const objectUrl=URL.createObjectURL(await response.blob());const link=document.createElement("a");link.href=objectUrl;link.download=image.name;document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}catch(reason){console.error(reason);window.open(await imageUrl(image.path),"_blank","noopener,noreferrer");}finally{setDownloading(false);}}
  const first=filtered.length?(page-1)*PAGE_SIZE+1:0; const last=Math.min(page*PAGE_SIZE,filtered.length);

  return <>
    {showLoadingScreen&&<div className="archive-loading-screen" role="status" aria-live="polite"><div className="archive-loading-card"><div className="spinner" aria-hidden="true"/><h2>Loading Image Archive</h2><p>Preparing the first results. The remaining archive will continue indexing in the background.</p><div className="archive-loading-progress" aria-hidden="true"/></div></div>}
    <div className="archive-shell">
      <aside className="sidebar"><div className="brand"><div className="brand-mark" aria-label="International Center of Photography">ICP</div><div><strong>Image Archive</strong><span>Digital Collection</span></div></div><div className="static-filters"><label htmlFor="archive-search">Search archive</label><input id="archive-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filename, folder, collection..."/><label htmlFor="collection-filter">Collection</label><select id="collection-filter" value={collection} onChange={e=>setCollection(e.target.value)}><option value={ALL_COLLECTIONS}>All collections</option>{collections.map(v=><option key={v}>{v}</option>)}</select><label htmlFor="category-filter">Category</label><select id="category-filter" value={category} onChange={e=>setCategory(e.target.value)}><option value={ALL_CATEGORIES}>All categories</option>{categories.map(v=><option key={v}>{v}</option>)}</select><button className="clear-button" onClick={clearFilters}>Clear filters</button><div className="result-count"><span>{indexingArchive?"Indexed so far":"Results"}</span><strong>{filtered.length.toLocaleString()}</strong></div>{indexingArchive&&<div className="indexing-note">Archive available. Indexing remaining files in the background...</div>}</div></aside>
      <main className="main-content"><header className="top-header"><div><h1>Image Archive</h1><p>People. Photographs. A brighter tomorrow.</p></div></header>{error?<div className="status error"><strong>Archive unavailable</strong><p>{error}</p></div>:<div className={selected?"content-layout details-open":"content-layout"}><section className="results-area"><div className="results-toolbar"><div className="results-summary"><strong>{filtered.length.toLocaleString()} {indexingArchive?"indexed":"results"}</strong>{filtered.length>0&&<span>Showing {first} to {last}</span>}</div><nav className="pagination"><button onClick={()=>changePage(page-1)} disabled={page===1}>Previous</button><span>Page <strong>{page}</strong> of <strong>{totalPages}</strong></span><button onClick={()=>changePage(page+1)} disabled={page===totalPages}>Next</button></nav></div>{warning&&<div className="warning">{warning}</div>}{!filtered.length?<div className="status"><strong>No images found</strong></div>:<div className="image-grid">{pageImages.map((image,index)=><button key={image.path} className={selected?.path===image.path?"image-card selected":"image-card"} onClick={()=>image.url&&setSelected(image)} disabled={!image.url}><div className="thumbnail">{image.url&&BROWSER_IMAGE.test(image.path)?<img src={image.url} alt={image.name} loading={index<4?"eager":"lazy"} decoding="async" fetchPriority={index<4?"high":"auto"}/>:image.failed?<div className="no-preview">Unavailable</div>:<div className="thumbnail-skeleton"/>}</div><div className="card-details"><strong title={image.name}>{image.name}</strong><span>{image.collection}</span><span>{image.category}</span><small>{image.lastModified?image.lastModified.toLocaleDateString():"Date unavailable"}</small></div></button>)}</div>}<nav className="bottom-pagination"><button onClick={()=>changePage(page-1)} disabled={page===1}>Previous</button><span>{loadingPage?"Loading thumbnails...":`Page ${page} of ${totalPages}`}</span><button onClick={()=>changePage(page+1)} disabled={page===totalPages}>Next</button></nav></section>{selected&&<aside className="details-panel"><div className="details-header"><strong>{selected.name}</strong><button onClick={()=>setSelected(null)}>x</button></div><div className="details-preview">{selected.url&&<img src={selected.url} alt={selected.name}/>}</div><div className="details-actions"><button className="download-button" disabled={downloading} onClick={()=>void downloadImage(selected)}>{downloading?"Downloading...":"Download"}</button><a href={selected.url} target="_blank" rel="noreferrer">Open original</a></div><dl className="metadata"><div><dt>Filename</dt><dd>{selected.name}</dd></div><div><dt>Collection</dt><dd>{selected.collection}</dd></div><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Folder</dt><dd>{selected.folder}</dd></div><div><dt>File size</dt><dd>{formatBytes(selected.size)}</dd></div></dl></aside>}</div>}</main>
    </div>
  </>;
}
