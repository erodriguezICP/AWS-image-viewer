import { useEffect, useMemo, useRef, useState } from "react";
import { getUrl, list } from "aws-amplify/storage";
import "./App.css";

type ArchiveImage = {
  path: string;
  name: string;
  collection: string;
  category: string;
  folder: string;
  size?: number;
  lastModified?: Date;
};

type DisplayImage = ArchiveImage & { url: string };
type CachedUrl = { url: string; expiresAt: number };

const ARCHIVE_PATH = "Key Manifest/";
const S3_BUCKET = { bucketName: "manifest-inventory", region: "us-east-1" };
const PAGE_SIZE = 16;
const URL_EXPIRATION_SECONDS = 3600;
const URL_CACHE_SAFETY_MS = 60_000;
const URL_REQUEST_CONCURRENCY = 6;
const ALL_COLLECTIONS = "All collections";
const ALL_CATEGORIES = "All categories";
const UNCATEGORIZED = "Uncategorized";
const IMAGE_FILE = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;
const BROWSER_IMAGE = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

function getRelativeParts(path: string): string[] {
  const relativePath = path.startsWith(ARCHIVE_PATH)
    ? path.slice(ARCHIVE_PATH.length)
    : path;
  return relativePath.split("/").filter(Boolean);
}

function toArchiveImage(item: { path: string; size?: number; lastModified?: Date }): ArchiveImage {
  const parts = getRelativeParts(item.path);
  const folderParts = parts.slice(0, -1);
  return {
    path: item.path,
    name: parts.length > 0 ? parts[parts.length - 1] : item.path,
    collection: folderParts[0] ?? UNCATEGORIZED,
    category: folderParts[1] ?? UNCATEGORIZED,
    folder: folderParts.length ? folderParts.join(" / ") : UNCATEGORIZED,
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

function canPreview(path: string): boolean {
  return BROWSER_IMAGE.test(path);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export default function App() {
  const [images, setImages] = useState<ArchiveImage[]>([]);
  const [pageImages, setPageImages] = useState<DisplayImage[]>([]);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState(ALL_COLLECTIONS);
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DisplayImage | null>(null);
  const [loadingArchive, setLoadingArchive] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  const urlCache = useRef<Map<string, CachedUrl>>(new Map());
  const pendingUrlRequests = useRef<Map<string, Promise<string>>>(new Map());

  async function getImageUrl(path: string): Promise<string> {
    const now = Date.now();
    const cached = urlCache.current.get(path);

    if (cached && cached.expiresAt > now + URL_CACHE_SAFETY_MS) {
      return cached.url;
    }
    if (cached) urlCache.current.delete(path);

    const pending = pendingUrlRequests.current.get(path);
    if (pending) return pending;

    const request = getUrl({
      path,
      options: { bucket: S3_BUCKET, expiresIn: URL_EXPIRATION_SECONDS },
    })
      .then((result) => {
        const url = result.url.toString();
        urlCache.current.set(path, {
          url,
          expiresAt: Date.now() + URL_EXPIRATION_SECONDS * 1000,
        });
        return url;
      })
      .finally(() => pendingUrlRequests.current.delete(path));

    pendingUrlRequests.current.set(path, request);
    return request;
  }

  useEffect(() => {
    let active = true;

    async function loadArchive(): Promise<void> {
      try {
        setLoadingArchive(true);
        setError("");
        const result = await list({
          path: ARCHIVE_PATH,
          options: { listAll: true, bucket: S3_BUCKET },
        });

        const metadata = result.items
          .filter((item) => IMAGE_FILE.test(item.path))
          .map(toArchiveImage)
          .sort((a, b) => {
            const collectionOrder = a.collection.localeCompare(b.collection, undefined, {
              numeric: true,
              sensitivity: "base",
            });
            if (collectionOrder !== 0) return collectionOrder;
            const categoryOrder = a.category.localeCompare(b.category, undefined, {
              numeric: true,
              sensitivity: "base",
            });
            if (categoryOrder !== 0) return categoryOrder;
            return a.name.localeCompare(b.name, undefined, {
              numeric: true,
              sensitivity: "base",
            });
          });

        if (active) setImages(metadata);
      } catch (caughtError) {
        console.error("Unable to load archive:", caughtError);
        if (active) {
          setError(
            `Unable to load images from "${S3_BUCKET.bucketName}/${ARCHIVE_PATH}". Check the S3 prefix, bucket access, and Amplify Storage permissions.`,
          );
        }
      } finally {
        if (active) setLoadingArchive(false);
      }
    }

    void loadArchive();
    return () => { active = false; };
  }, []);

  const collections = useMemo(
    () => Array.from(new Set(images.map((image) => image.collection))).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    ),
    [images],
  );

  const categories = useMemo(() => {
    const scoped = collection === ALL_COLLECTIONS
      ? images
      : images.filter((image) => image.collection === collection);
    return Array.from(new Set(scoped.map((image) => image.category))).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
  }, [images, collection]);

  const filteredImages = useMemo(() => {
    const query = search.trim().toLowerCase();
    return images.filter((image) => {
      if (collection !== ALL_COLLECTIONS && image.collection !== collection) return false;
      if (category !== ALL_CATEGORIES && image.category !== category) return false;
      if (!query) return true;
      return [image.name, image.collection, image.category, image.folder, image.path]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [images, search, collection, category]);

  const totalPages = Math.max(1, Math.ceil(filteredImages.length / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
    setSelected(null);
  }, [search, collection, category]);

  useEffect(() => {
    setCategory(ALL_CATEGORIES);
  }, [collection]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const currentMetadata = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredImages.slice(start, start + PAGE_SIZE);
  }, [filteredImages, page]);

  useEffect(() => {
    let active = true;

    async function loadPage(): Promise<void> {
      if (currentMetadata.length === 0) {
        setPageImages([]);
        setWarning("");
        setLoadingPage(false);
        return;
      }

      try {
        setLoadingPage(true);
        setWarning("");
        setPageImages([]);

        const results = await mapWithConcurrency(
          currentMetadata,
          URL_REQUEST_CONCURRENCY,
          async (image): Promise<DisplayImage> => ({
            ...image,
            url: await getImageUrl(image.path),
          }),
        );

        if (!active) return;

        const loaded: DisplayImage[] = [];
        let failures = 0;
        for (const result of results) {
          if (result.status === "fulfilled") loaded.push(result.value);
          else {
            failures += 1;
            console.error("Image URL generation failed:", result.reason);
          }
        }

        setPageImages(loaded);
        if (failures > 0) {
          setWarning(`${failures} image${failures === 1 ? "" : "s"} could not be loaded.`);
        }
      } catch (caughtError) {
        console.error("Unable to load page:", caughtError);
        if (active) setWarning("Unable to load the current page.");
      } finally {
        if (active) setLoadingPage(false);
      }
    }

    void loadPage();
    return () => { active = false; };
  }, [currentMetadata]);

  function changePage(nextPage: number): void {
    setPage(Math.max(1, Math.min(nextPage, totalPages)));
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

  async function downloadImage(image: DisplayImage): Promise<void> {
    try {
      setDownloading(true);
      setWarning("");
      const freshUrl = await getImageUrl(image.path);
      const response = await fetch(freshUrl);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = image.name || "archive-image";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (caughtError) {
      console.error("Unable to download image:", caughtError);
      try {
        window.open(await getImageUrl(image.path), "_blank", "noopener,noreferrer");
        setWarning("Direct download was blocked, so the original image was opened instead.");
      } catch (fallbackError) {
        console.error("Unable to open original:", fallbackError);
        setWarning("The image could not be downloaded or opened.");
      }
    } finally {
      setDownloading(false);
    }
  }

  const firstResult = filteredImages.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastResult = Math.min(page * PAGE_SIZE, filteredImages.length);

  return (
    <div className="archive-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">ICP</div>
          <div><strong>Image Archive</strong><span>Digital Collection</span></div>
        </div>
        <div className="static-filters">
          <label htmlFor="archive-search">Search archive</label>
          <input id="archive-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filename, folder, collection..." autoComplete="off" />
          <label htmlFor="collection-filter">Collection</label>
          <select id="collection-filter" value={collection} onChange={(event) => setCollection(event.target.value)}>
            <option value={ALL_COLLECTIONS}>All collections</option>
            {collections.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <label htmlFor="category-filter">Category</label>
          <select id="category-filter" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value={ALL_CATEGORIES}>All categories</option>
            {categories.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button type="button" className="clear-button" onClick={clearFilters}>Clear filters</button>
          <div className="result-count"><span>Results</span><strong>{filteredImages.length.toLocaleString()}</strong></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-header"><div><h1>Image Archive</h1><p>People. Photographs. A brighter tomorrow.</p></div></header>
        {loadingArchive ? (
          <div className="status"><div className="spinner" aria-hidden="true" /><strong>Loading archive...</strong></div>
        ) : error ? (
          <div className="status error"><strong>Archive unavailable</strong><p>{error}</p></div>
        ) : (
          <div className={selected ? "content-layout details-open" : "content-layout"}>
            <section className="results-area">
              <div className="results-toolbar">
                <div className="results-summary"><strong>{filteredImages.length.toLocaleString()} results</strong>{filteredImages.length > 0 && <span>Showing {firstResult} to {lastResult}</span>}</div>
                <nav className="pagination" aria-label="Archive pagination">
                  <button type="button" onClick={() => changePage(page - 1)} disabled={page === 1 || loadingPage}>Previous</button>
                  <span>Page <strong>{page}</strong> of <strong>{totalPages}</strong></span>
                  <button type="button" onClick={() => changePage(page + 1)} disabled={page === totalPages || loadingPage}>Next</button>
                </nav>
              </div>

              {warning && <div className="warning">{warning}</div>}
              {filteredImages.length === 0 ? (
                <div className="status"><strong>No images found</strong><p>Change the search, collection, or category.</p></div>
              ) : loadingPage ? (
                <div className="status"><div className="spinner" aria-hidden="true" /><strong>Loading page {page}...</strong></div>
              ) : (
                <div className="image-grid">
                  {pageImages.map((image, index) => (
                    <button key={image.path} type="button" className={selected?.path === image.path ? "image-card selected" : "image-card"} onClick={() => setSelected(image)}>
                      <div className="thumbnail">
                        {canPreview(image.path) ? (
                          <img src={image.url} alt={image.name} loading={index < 4 ? "eager" : "lazy"} decoding="async" fetchPriority={index < 4 ? "high" : "auto"} />
                        ) : <div className="no-preview">TIFF</div>}
                      </div>
                      <div className="card-details"><strong title={image.name}>{image.name}</strong><span>{image.collection}</span><span>{image.category}</span><small>{image.lastModified ? image.lastModified.toLocaleDateString() : "Date unavailable"}</small></div>
                    </button>
                  ))}
                </div>
              )}

              {filteredImages.length > 0 && (
                <nav className="bottom-pagination" aria-label="Bottom pagination">
                  <button type="button" onClick={() => changePage(page - 1)} disabled={page === 1 || loadingPage}>Previous</button>
                  <span>Page {page} of {totalPages}</span>
                  <button type="button" onClick={() => changePage(page + 1)} disabled={page === totalPages || loadingPage}>Next</button>
                </nav>
              )}
            </section>

            {selected && (
              <aside className="details-panel">
                <div className="details-header"><strong title={selected.name}>{selected.name}</strong><button type="button" onClick={() => setSelected(null)} aria-label="Close details panel">x</button></div>
                <div className="details-preview">{canPreview(selected.path) ? <img src={selected.url} alt={selected.name} /> : <div className="no-preview">TIFF preview unavailable</div>}</div>
                <div className="details-actions">
                  <button type="button" className="download-button" onClick={() => void downloadImage(selected)} disabled={downloading}>{downloading ? "Downloading..." : "Download"}</button>
                  <a href={selected.url} target="_blank" rel="noreferrer">Open original</a>
                </div>
                <dl className="metadata">
                  <div><dt>Filename</dt><dd>{selected.name}</dd></div>
                  <div><dt>Collection</dt><dd>{selected.collection}</dd></div>
                  <div><dt>Category</dt><dd>{selected.category}</dd></div>
                  <div><dt>Folder</dt><dd>{selected.folder}</dd></div>
                  <div><dt>File size</dt><dd>{formatBytes(selected.size)}</dd></div>
                  <div><dt>Modified</dt><dd>{selected.lastModified ? selected.lastModified.toLocaleDateString() : "Unavailable"}</dd></div>
                </dl>
              </aside>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
