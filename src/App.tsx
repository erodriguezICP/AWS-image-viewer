import { useEffect, useMemo, useRef, useState } from "react";
import { getUrl, list } from "aws-amplify/storage";
import "./App.css";

type ArchiveImage = { path:string; thumbnailPath:string; name:string; collection:string; category:string; folder:string; size?:number; lastModified?:Date };
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
const TIFF_IMAGE = /\.tiff?$/i;
const THUMBNAIL_PATH = "Key Manifest Thumbnails/";

function relativeParts(path:string):string[]{
  const relative=path.startsWith(ARCHIVE_PATH)?path.slice(ARCHIVE_PATH.length):path;
  return relative.split("/").filter(Boolean);
}
function thumbnailPathFor(path:string):string{
  if(!TIFF_IMAGE.test(path)) return path;
  const relative=path.startsWith(ARCHIVE_PATH)?path.slice(ARCHIVE_PATH.length):path;
  return `${THUMBNAIL_PATH}${relative.replace(/\.tiff?$/i,".jpg")}`;
}
function toImage(item:{path:string;size?:number;lastModified?:Date}):ArchiveImage{
  const parts=relativeParts(item.path); const folders=parts.slice(0,-1);
  return {path:item.path,thumbnailPath:thumbnailPathFor(item.path),name:parts.length?parts[parts.length-1]:item.path,collection:folders[0]??UNCATEGORIZED,category:folders[1]??UNCATEGORIZED,folder:folders.length?folders.join(" / "):UNCATEGORIZED,size:item.size,lastModified:item.lastModified};
}
function formatBytes(bytes?:number):string{if(bytes===undefined)return"Unknown";if(bytes<1024)return`${bytes} B`;if(bytes<1048576)return`${(bytes/1024).toFixed(1)} KB`;return`${(bytes/1048576).toFixed(1)} MB`;}
function timeout<T>(promise:Promise<T>,ms:number):Promise<T>{return new Promise((resolve,reject)=>{const timer=window.setTimeout(()=>reject(new Error("Request timed out")),ms);promise.then(v=>{window.clearTimeout(timer);resolve(v);},e=>{window.clearTimeout(timer);reject(e);});});}

export default function App(){
  const [images,setImages]=useState<ArchiveImage[]>([]),[pageImages,setPageImages]=useState<DisplayImage[]>([]);
  const [search,setSearch]=useState(""),[collection,setCollection]=useState(ALL_COLLECTIONS),[category,setCategory]=useState(ALL_CATEGORIES);
  const [page,setPage]=useState(1),[selected,setSelected]=useState<DisplayImage|null>(null);
  const [loadingInitial,setLoadingInitial]=useState(true),[showLoading,setShowLoading]=useState(true),[indexing,setIndexing]=useState(false),[loadingPage,setLoadingPage]=useState(false),[downloading,setDownloading]=useState(false);
  const [error,setError]=useState(""),[warning,setWarning]=useState("");
  const cache=useRef<Map<string,CachedUrl>>(new Map()),pending=useRef<Map<string,Promise<string>>>(new Map());

  async function imageUrl(path:string):Promise<string>{
    const now=Date.now(),cached=cache.current.get(path);if(cached&&cached.expiresAt>now+URL_CACHE_SAFETY_MS)return cached.url;
    const existing=pending.current.get(path);if(existing)return existing;
    const request=timeout(getUrl({path,options:{bucket:S3_BUCKET,expiresIn:URL_EXPIRATION_SECONDS}}),URL_TIMEOUT_MS).then(r=>{const url=r.url.toString();cache.current.set(path,{url,expiresAt:Date.now()+URL_EXPIRATION_SECONDS*1000});return url;}).finally(()=>pending.current.delete(path));
    pending.current.set(path,request);return request;
  }

  useEffect(()=>{let active=true;(async()=>{let nextToken:string|undefined,first=true;try{setError("");do{const r=await list({path:ARCHIVE_PATH,options:{bucket:S3_BUCKET,pageSize:METADATA_BATCH_SIZE,nextToken}});if(!active)return;setImages(prev=>[...prev,...r.items.filter(i=>IMAGE_FILE.test(i.path)).map(toImage)]);nextToken=r.nextToken;if(first){first=false;setLoadingInitial(false);setIndexing(Boolean(nextToken));}await new Promise<void>(resolve=>window.setTimeout(resolve,0));}while(active&&nextToken);if(active)setIndexing(false);}catch(e){console.error(e);if(active)setError(`Unable to load images from "${S3_BUCKET.bucketName}/${ARCHIVE_PATH}".`);}finally{if(active)setLoadingInitial(false);}})();return()=>{active=false;};},[]);
  useEffect(()=>{if((!loadingInitial&&images.length)||error){const t=window.setTimeout(()=>setShowLoading(false),250);return()=>window.clearTimeout(t);}return undefined;},[loadingInitial,images.length,error]);

  const collections=useMemo(()=>Array.from(new Set(images.map(i=>i.collection))).sort(),[images]);
  const categories=useMemo(()=>Array.from(new Set((collection===ALL_COLLECTIONS?images:images.filter(i=>i.collection===collection)).map(i=>i.category))).sort(),[images,collection]);
  const filtered=useMemo(()=>{const q=search.trim().toLowerCase();return images.filter(i=>(collection===ALL_COLLECTIONS||i.collection===collection)&&(category===ALL_CATEGORIES||i.category===category)&&(!q||[i.name,i.collection,i.category,i.folder,i.path].join(" ").toLowerCase().includes(q)));},[images,search,collection,category]);
  const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const current=useMemo(()=>filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE),[filtered,page]);
  useEffect(()=>{setPage(1);setSelected(null);},[search,collection,category]);useEffect(()=>setCategory(ALL_CATEGORIES),[collection]);useEffect(()=>{if(page>totalPages)setPage(totalPages);},[page,totalPages]);

  useEffect(()=>{let active=true,next=0,done=0,fail=0;setSelected(null);setWarning("");setPageImages(current.map(i=>({...i})));if(!current.length){setLoadingPage(false);return()=>{active=false;};}setLoadingPage(true);async function worker(){while(active&&next<current.length){const index=next++;try{const url=await imageUrl(current[index].thumbnailPath);if(active)setPageImages(prev=>prev.map((i,n)=>n===index?{...i,url}:i));}catch(e){fail++;console.error(e);if(active)setPageImages(prev=>prev.map((i,n)=>n===index?{...i,failed:true}:i));}finally{done++;if(active&&done===current.length){setLoadingPage(false);if(fail)setWarning(`${fail} image${fail===1?"":"s"} could not be loaded.`);}}}}void Promise.all(Array.from({length:Math.min(URL_CONCURRENCY,current.length)},()=>worker()));return()=>{active=false;};},[current]);

  function changePage(v:number){setPage(Math.max(1,Math.min(v,totalPages)));setSelected(null);window.scrollTo({top:0,behavior:"smooth"});}
  function clearFilters(){setSearch("");setCollection(ALL_COLLECTIONS);setCategory(ALL_CATEGORIES);setPage(1);setSelected(null);}
  async function openOriginal(image:DisplayImage){
    try{window.open(await imageUrl(image.path),"_blank","noopener,noreferrer");}catch(reason){console.error(reason);setWarning("The original file could not be opened.");}
  }
  async function download(image:DisplayImage){try{setDownloading(true);const response=await fetch(await imageUrl(image.path));if(!response.ok)throw new Error(String(response.status));const objectUrl=URL.createObjectURL(await response.blob());const a=document.createElement("a");a.href=objectUrl;a.download=image.name;document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}finally{setDownloading(false);}}
  const first=filtered.length?(page-1)*PAGE_SIZE+1:0,last=Math.min(page*PAGE_SIZE,filtered.length);

  return <>
    {showLoading&&<div className="archive-loading-screen"><div className="archive-loading-card"><div className="spinner"/><h2>Loading Digital Archives</h2><p>Preparing the first results. The remaining archive continues indexing in the background.</p><div className="archive-loading-progress"/></div></div>}
    <div className="archive-shell">
      <aside className="sidebar">
        <div className="brand"><div className="icp-logo" aria-label="International Center of Photography logo"><span className="icp-symbol">ICP</span><span className="icp-name">International<br/>Center of<br/>Photography</span></div><div className="brand-divider"/><div className="archive-brand-title">Digital<br/>Archives</div></div>
        <div className="static-filters"><label htmlFor="archive-search">Search archive</label><input id="archive-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filename, folder, collection..."/><label htmlFor="collection">Collection</label><select id="collection" value={collection} onChange={e=>setCollection(e.target.value)}><option value={ALL_COLLECTIONS}>All collections</option>{collections.map(v=><option key={v}>{v}</option>)}</select><label htmlFor="category">Category</label><select id="category" value={category} onChange={e=>setCategory(e.target.value)}><option value={ALL_CATEGORIES}>All categories</option>{categories.map(v=><option key={v}>{v}</option>)}</select><button className="clear-button" onClick={clearFilters}>Clear filters</button><div className="result-count"><span>{indexing?"Indexed so far":"Results"}</span><strong>{filtered.length.toLocaleString()}</strong></div></div>
      </aside>
      <main className="main-content"><header className="top-header"><h1>Digital Archives</h1><p>People. Photographs. A brighter tomorrow.</p></header>{error?<div className="status error">{error}</div>:<div className={selected?"content-layout details-open":"content-layout"}><section className="results-area"><div className="results-toolbar"><div className="results-summary"><strong>{filtered.length.toLocaleString()} {indexing?"indexed":"results"}</strong><span>Showing {first} to {last}</span></div><nav className="pagination"><button onClick={()=>changePage(page-1)} disabled={page===1}>Previous</button><span>Page {page} of {totalPages}</span><button onClick={()=>changePage(page+1)} disabled={page===totalPages}>Next</button></nav></div>{warning&&<div className="warning">{warning}</div>}<div className="image-grid">{pageImages.map((image,index)=><button key={image.path} className={selected?.path===image.path?"image-card selected":"image-card"} disabled={!image.url} onClick={()=>image.url&&setSelected(image)}><div className="thumbnail">{image.url?<img src={image.url} alt={image.name} loading={index<4?"eager":"lazy"} decoding="async" fetchPriority={index<4?"high":"auto"}/>:image.failed?<div className="no-preview">Unavailable</div>:<div className="thumbnail-skeleton"/>}</div><div className="card-details"><strong>{image.name}</strong><span>{image.collection}</span><span>{image.category}</span><small>{image.lastModified?image.lastModified.toLocaleDateString():"Date unavailable"}</small></div></button>)}</div><nav className="bottom-pagination"><button onClick={()=>changePage(page-1)} disabled={page===1}>Previous</button><span>{loadingPage?"Loading thumbnails...":`Page ${page} of ${totalPages}`}</span><button onClick={()=>changePage(page+1)} disabled={page===totalPages}>Next</button></nav></section>{selected&&<aside className="details-panel"><div className="details-header"><strong>{selected.name}</strong><button onClick={()=>setSelected(null)}>x</button></div><div className="details-preview">{selected.url&&<img src={selected.url} alt={selected.name}/>}</div><div className="details-actions"><button className="download-button" disabled={downloading} onClick={()=>void download(selected)}>{downloading?"Downloading...":"Download"}</button><button type="button" className="original-button" onClick={()=>void openOriginal(selected)}>Open original</button></div><dl className="metadata"><div><dt>Filename</dt><dd>{selected.name}</dd></div><div><dt>Collection</dt><dd>{selected.collection}</dd></div><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Folder</dt><dd>{selected.folder}</dd></div><div><dt>File size</dt><dd>{formatBytes(selected.size)}</dd></div></dl></aside>}</div>}</main>
    </div>
  </>;
}
