import { useEffect, useMemo, useRef, useState } from "react";
import { getUrl, list } from "aws-amplify/storage";
import "./App.css";

type ArchiveImage = {
  path: string;
  thumbnailPath: string;
  name: string;
  collection: string;
  category: string;
  folder: string;
  size?: number;
  lastModified?: Date;
};

type DisplayImage = ArchiveImage & {
  url?: string;
  failed?: boolean;
};

type CachedUrl = { url: string; expiresAt: number };

const ARCHIVE_PATH = "Key Manifest/";
const THUMBNAIL_PATH = "Key Manifest Thumbnails/";
const S3_BUCKET = { bucketName: "manifest-inventory", region: "us-east-1" };
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
const JPEG_IMAGE = /\.jpe?g$/i;

function relativeParts(path: string): string[] {
  const relative = path.startsWith(ARCHIVE_PATH) ? path.slice(ARCHIVE_PATH.length) : path;
  return relative.split("/").filter(Boolean);
}

function thumbnailPathFor(path: string): string {
  if (!TIFF_IMAGE.test(path)) return path;
  const relative = path.startsWith(ARCHIVE_PATH) ? path.slice(ARCHIVE_PATH.length) : path;
  return `${THUMBNAIL_PATH}${relative.replace(/\.tiff?$/i, ".jpg")}`;
}

function toArchiveImage(item: { path: string; size?: number; lastModified?: Date }): ArchiveImage {
  const parts = relativeParts(item.path);
  const folders = parts.slice(0, -1);
  return {
    path: item.path,
    thumbnailPath: thumbnailPathFor(item.path),
    name: parts.length ? parts[parts.length - 1] : item.path,
    collection: folders[0] ?? UNCATEGORIZED,
    category: folders[1] ?? UNCATEGORIZED,
    folder: folders.length ? folders.join(" / ") : UNCATEGORIZED,
    size: item.size,
    lastModified: item.lastModified,
  };
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Request timed out")), timeoutMs);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (reason) => { window.clearTimeout(timer); reject(reason); },
    );
  });
}

export default function App() {
  const [images, setImages] = useState<ArchiveImage[]>([]);
  const [pageImages, setPageImages] = useState<DisplayImage[]>([]);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState(ALL_COLLECTIONS);
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DisplayImage | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [showLoading, setShowLoading] = useState(true);
  const [indexing, setIndexing] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  const urlCache = useRef<Map<string, CachedUrl>>(new Map());
  const pendingUrls = useRef<Map<string, Promise<string>>>(new Map());
  const displayCache = useRef<Map<string, DisplayImage>>(new Map());

  async function getImageUrl(path: string): Promise<string> {
    const now = Date.now();
    const cached = urlCache.current.get(path);
    if (cached && cached.expiresAt > now + URL_CACHE_SAFETY_MS) return cached.url;

    const pending = pendingUrls.current.get(path);
    if (pending) return pending;

    const request = withTimeout(
      getUrl({ path, options: { bucket: S3_BUCKET, expiresIn: URL_EXPIRATION_SECONDS } }),
      URL_TIMEOUT_MS,
    ).then((result) => {
      const url = result.url.toString();
      urlCache.current.set(path, { url, expiresAt: Date.now() + URL_EXPIRATION_SECONDS * 1000 });
      return url;
    }).finally(() => pendingUrls.current.delete(path));

    pendingUrls.current.set(path, request);
    return request;
  }

  useEffect(() => {
    let active = true;
    (async () => {
      let nextToken: string | undefined;
      let firstBatch = true;
      try {
        setError("");
        do {
          const result = await list({
            path: ARCHIVE_PATH,
            options: { bucket: S3_BUCKET, pageSize: METADATA_BATCH_SIZE, nextToken },
          });
          if (!active) return;
          const batch = result.items.filter((item) => IMAGE_FILE.test(item.path)).map(toArchiveImage);
          setImages((previous) => [...previous, ...batch]);
          nextToken = result.nextToken;
          if (firstBatch) {
            firstBatch = false;
            setLoadingInitial(false);
            setIndexing(Boolean(nextToken));
          }
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        } while (active && nextToken);
        if (active) setIndexing(false);
      } catch (reason) {
        console.error(reason);
        if (active) setError(`Unable to load images from "${S3_BUCKET.bucketName}/${ARCHIVE_PATH}".`);
      } finally {
        if (active) setLoadingInitial(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if ((!loadingInitial && images.length > 0) || error) {
      const timer = window.setTimeout(() => setShowLoading(false), 250);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [loadingInitial, images.length, error]);

  const collections = useMemo(() => Array.from(new Set(images.map((image) => image.collection))).sort(), [images]);
  const categories = useMemo(() => {
    const scoped = collection === ALL_COLLECTIONS ? images : images.filter((image) => image.collection === collection);
    return Array.from(new Set(scoped.map((image) => image.category))).sort();
  }, [images, collection]);

  const filteredImages = useMemo(() => {
    const query = search.trim().toLowerCase();
    return images.filter((image) =>
      (collection === ALL_COLLECTIONS || image.collection === collection) &&
      (category === ALL_CATEGORIES || image.category === category) &&
      (!query || [image.name, image.collection, image.category, image.folder, image.path].join(" ").toLowerCase().includes(query)),
    );
  }, [images, search, collection, category]);

  const totalPages = Math.max(1, Math.ceil(filteredImages.length / PAGE_SIZE));
  const currentMetadata = useMemo(() => filteredImages.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredImages, page]);
  const pageKey = useMemo(() => currentMetadata.map((image) => image.path).join("\n"), [currentMetadata]);

  useEffect(() => { setPage(1); setSelected(null); }, [search, collection, category]);
  useEffect(() => { setCategory(ALL_CATEGORIES); }, [collection]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  useEffect(() => {
    let active = true;
    let cursor = 0;
    let completed = 0;
    let failures = 0;

    const snapshot: DisplayImage[] = currentMetadata.map((image): DisplayImage => {
      const cached = displayCache.current.get(image.path);
      return cached
        ? { ...image, url: cached.url, failed: cached.failed ?? false }
        : { ...image, url: undefined, failed: false };
    });

    setSelected(null);
    setWarning("");
    setPageImages(snapshot);

    const missing = snapshot.map((image, index) => image.url || image.failed ? -1 : index).filter((index) => index >= 0);
    if (!missing.length) {
      setLoadingPage(false);
      return () => { active = false; };
    }

    setLoadingPage(true);

    async function worker(): Promise<void> {
      while (active && cursor < missing.length) {
        const index = missing[cursor++];
        const image = snapshot[index];
        try {
          const url = await getImageUrl(image.thumbnailPath);
          const loaded: DisplayImage = { ...image, url, failed: false };
          displayCache.current.set(image.path, loaded);
          if (active) setPageImages((previous) => previous.map((item) => item.path === image.path ? loaded : item));
        } catch (reason) {
          failures += 1;
          console.error(reason);
          const failed: DisplayImage = { ...image, failed: true };
          displayCache.current.set(image.path, failed);
          if (active) setPageImages((previous) => previous.map((item) => item.path === image.path ? failed : item));
        } finally {
          completed += 1;
          if (active && completed === missing.length) {
            setLoadingPage(false);
            if (failures) setWarning(`${failures} image${failures === 1 ? "" : "s"} could not be loaded.`);
          }
        }
      }
    }

    void Promise.all(Array.from({ length: Math.min(URL_CONCURRENCY, missing.length) }, () => worker()));
    return () => { active = false; };
  }, [pageKey]);

  function changePage(value: number): void {
    setPage(Math.max(1, Math.min(value, totalPages)));
    setSelected(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearFilters(): void {
    setSearch("");
    setCollection(ALL_COLLECTIONS);
    setCategory(ALL_CATEGORIES);
    setPage(1);
    setSelected(null);
  }

  async function downloadOriginal(image: DisplayImage): Promise<void> {
    try {
      setDownloading(true);
      setWarning("");
      const response = await fetch(await getImageUrl(image.path));
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = image.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (reason) {
      console.error(reason);
      setWarning("The file could not be downloaded.");
    } finally {
      setDownloading(false);
    }
  }

  const first = filteredImages.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, filteredImages.length);

  return (
    <>
      {showLoading && (
        <div className="archive-loading-screen" role="status" aria-live="polite">
          <div className="archive-loading-card"><div className="spinner" /><h2>Loading Digital Archives</h2><p>Preparing the first results. The remaining archive continues indexing in the background.</p><div className="archive-loading-progress" /></div>
        </div>
      )}

      <div className="archive-shell">
        <aside className="sidebar">
          <div className="brand"><div className="icp-logo"><span className="icp-symbol">ICP</span><span className="icp-name">International<br />Center of<br />Photography</span></div><div className="brand-divider" /><div className="archive-brand-title">Digital<br />Archives</div></div>
          <div className="static-filters">
            <label htmlFor="archive-search">Search archive</label>
            <input id="archive-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filename, folder, collection..." />
            <label htmlFor="collection">Collection</label>
            <select id="collection" value={collection} onChange={(event) => setCollection(event.target.value)}><option value={ALL_COLLECTIONS}>All collections</option>{collections.map((value) => <option key={value}>{value}</option>)}</select>
            <label htmlFor="category">Category</label>
            <select id="category" value={category} onChange={(event) => setCategory(event.target.value)}><option value={ALL_CATEGORIES}>All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
            <button type="button" className="clear-button" onClick={clearFilters}>Clear filters</button>
            <div className="result-count"><span>{indexing ? "Indexed so far" : "Results"}</span><strong>{filteredImages.length.toLocaleString()}</strong></div>
          </div>
        </aside>

        <main className="main-content">
          <header className="top-header"><h1>Digital Archives</h1><p>People. Photographs. A brighter tomorrow.</p></header>
          {error ? <div className="status error">{error}</div> : (
            <div className={selected ? "content-layout details-open" : "content-layout"}>
              <section className="results-area">
                <div className="results-toolbar"><div className="results-summary"><strong>{filteredImages.length.toLocaleString()} {indexing ? "indexed" : "results"}</strong><span>Showing {first} to {last}</span></div><nav className="pagination"><button onClick={() => changePage(page - 1)} disabled={page === 1}>Previous</button><span>Page {page} of {totalPages}</span><button onClick={() => changePage(page + 1)} disabled={page === totalPages}>Next</button></nav></div>
                {warning && <div className="warning">{warning}</div>}

                <div className="image-grid">
                  {pageImages.map((image, index) => {
                    const isTiff = TIFF_IMAGE.test(image.path);
                    return (
                      <button key={image.path} type="button" className={selected?.path === image.path ? "image-card selected" : "image-card"} disabled={!image.url} onClick={() => image.url && setSelected(image)}>
                        <div className="thumbnail">
                          {image.url && !isTiff ? (
                            <img src={image.url} alt={image.name} loading={index < 4 ? "eager" : "lazy"} decoding="async" fetchPriority={index < 4 ? "high" : "auto"} />
                          ) : isTiff ? (
                            <div className="tiff-download-preview"><strong>TIFF</strong><span>Download to view</span></div>
                          ) : image.failed ? (
                            <div className="no-preview">Unavailable</div>
                          ) : (
                            <div className="thumbnail-skeleton" />
                          )}
                        </div>
                        <div className="card-details"><strong>{image.name}</strong><span>{image.collection}</span><span>{image.category}</span><small>{image.lastModified ? image.lastModified.toLocaleDateString() : "Date unavailable"}</small></div>
                      </button>
                    );
                  })}
                </div>

                <nav className="bottom-pagination"><button onClick={() => changePage(page - 1)} disabled={page === 1}>Previous</button><span>{loadingPage ? "Loading thumbnails..." : `Page ${page} of ${totalPages}`}</span><button onClick={() => changePage(page + 1)} disabled={page === totalPages}>Next</button></nav>
              </section>

              {selected && (
                <aside className="details-panel">
                  <div className="details-header"><strong>{selected.name}</strong><button onClick={() => setSelected(null)}>x</button></div>
                  <div className="details-preview">
                    {TIFF_IMAGE.test(selected.path) ? (
                      <div className="tiff-download-preview details-tiff"><strong>TIFF file</strong><span>Download to view</span></div>
                    ) : selected.url ? (
                      <img src={selected.url} alt={selected.name} />
                    ) : null}
                  </div>
                  <div className="details-actions">
                    {(JPEG_IMAGE.test(selected.path) || TIFF_IMAGE.test(selected.path)) && (
                      <button className="download-button" disabled={downloading} onClick={() => void downloadOriginal(selected)}>{downloading ? "Downloading..." : TIFF_IMAGE.test(selected.path) ? "Download TIFF to view" : "Download JPG"}</button>
                    )}
                  </div>
                  <dl className="metadata"><div><dt>Filename</dt><dd>{selected.name}</dd></div><div><dt>Collection</dt><dd>{selected.collection}</dd></div><div><dt>Category</dt><dd>{selected.category}</dd></div><div><dt>Folder</dt><dd>{selected.folder}</dd></div><div><dt>File size</dt><dd>{formatBytes(selected.size)}</dd></div></dl>
                </aside>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
