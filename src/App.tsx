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

type DisplayImage = ArchiveImage & {
  url?: string;
  failed?: boolean;
};

type CachedUrl = {
  url: string;
  expiresAt: number;
};

const ARCHIVE_PATH = "Key Manifest/";
const S3_BUCKET = { bucketName: "manifest-inventory", region: "us-east-1" };
const PAGE_SIZE = 16;
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

function getRelativeParts(path: string): string[] {
  const relativePath = path.startsWith(ARCHIVE_PATH)
    ? path.slice(ARCHIVE_PATH.length)
    : path;
  return relativePath.split("/").filter(Boolean);
}

function toArchiveImage(item: {
  path: string;
  size?: number;
  lastModified?: Date;
}): ArchiveImage {
  const parts = getRelativeParts(item.path);
  const folders = parts.slice(0, -1);

  return {
    path: item.path,
    name: parts.length > 0 ? parts[parts.length - 1] : item.path,
    collection: folders.length > 0 ? folders[0] : UNCATEGORIZED,
    category: folders.length > 1 ? folders[1] : UNCATEGORIZED,
    folder: folders.length > 0 ? folders.join(" / ") : UNCATEGORIZED,
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
    const timeout = window.setTimeout(
      () => reject(new Error(`Request timed out after ${timeoutMs / 1000} seconds.`)),
      timeoutMs,
    );

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (reason) => {
        window.clearTimeout(timeout);
        reject(reason);
      },
    );
  });
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export default function App() {
  const [images, setImages] = useState<ArchiveImage[]>([]);
  const [pageImages, setPageImages] = useState<DisplayImage[]>([]);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState(ALL_COLLECTIONS);
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DisplayImage | null>(null);
  const [loadingInitialBatch, setLoadingInitialBatch] = useState(true);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  const [indexingArchive, setIndexingArchive] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  const urlCache = useRef<Map<string, CachedUrl>>(new Map());
  const pendingUrls = useRef<Map<string, Promise<string>>>(new Map());

  async function getImageUrl(path: string): Promise<string> {
    const now = Date.now();
    const cached = urlCache.current.get(path);

    if (cached && cached.expiresAt > now + URL_CACHE_SAFETY_MS) {
      return cached.url;
    }

    if (cached) urlCache.current.delete(path);

    const pending = pendingUrls.current.get(path);
    if (pending) return pending;

    const request = withTimeout(
      getUrl({
        path,
        options: {
          bucket: S3_BUCKET,
          expiresIn: URL_EXPIRATION_SECONDS,
        },
      }),
      URL_TIMEOUT_MS,
    )
      .then((result) => {
        const url = result.url.toString();
        urlCache.current.set(path, {
          url,
          expiresAt: Date.now() + URL_EXPIRATION_SECONDS * 1000,
        });
        return url;
      })
      .finally(() => {
        pendingUrls.current.delete(path);
      });

    pendingUrls.current.set(path, request);
    return request;
  }

  useEffect(() => {
    let active = true;

    async function loadArchiveProgressively(): Promise<void> {
      let nextToken: string | undefined;
      let firstBatch = true;

      try {
        setLoadingInitialBatch(true);
        setError("");

        do {
          const result = await list({
            path: ARCHIVE_PATH,
            options: {
              bucket: S3_BUCKET,
              pageSize: METADATA_BATCH_SIZE,
              nextToken,
            },
          });

          if (!active) return;

          const batch = result.items
            .filter((item) => IMAGE_FILE.test(item.path))
            .map(toArchiveImage);

          setImages((previous) => [...previous, ...batch]);
          nextToken = result.nextToken;

          if (firstBatch) {
            firstBatch = false;
            setLoadingInitialBatch(false);
            setIndexingArchive(Boolean(nextToken));
          }

          await yieldToBrowser();
        } while (active && nextToken);

        if (active) setIndexingArchive(false);
      } catch (caughtError) {
        console.error("Unable to load archive:", caughtError);
        if (active) {
          setError(
            `Unable to load images from "${S3_BUCKET.bucketName}/${ARCHIVE_PATH}". Check the S3 prefix and Storage permissions.`,
          );
        }
      } finally {
        if (active) {
          setLoadingInitialBatch(false);
          setIndexingArchive(false);
        }
      }
    }

    void loadArchiveProgressively();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if ((!loadingInitialBatch && images.length > 0) || error) {
      const timeout = window.setTimeout(() => setShowLoadingScreen(false), 250);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [loadingInitialBatch, images.length, error]);

  const collections = useMemo(
    () =>
      Array.from(new Set(images.map((image) => image.collection))).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      ),
    [images],
  );

  const categories = useMemo(() => {
    const scoped =
      collection === ALL_COLLECTIONS
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
    let nextIndex = 0;
    let completed = 0;
    let failures = 0;

    setSelected(null);
    setWarning("");
    setPageImages(currentMetadata.map((image) => ({ ...image })));

    if (currentMetadata.length === 0) {
      setLoadingPage(false);
      return () => {
        active = false;
      };
    }

    setLoadingPage(true);

    async function worker(): Promise<void> {
      while (active && nextIndex < currentMetadata.length) {
        const index = nextIndex;
        nextIndex += 1;

        try {
          const url = await getImageUrl(currentMetadata[index].path);
          if (active) {
            setPageImages((previous) =>
              previous.map((image, imageIndex) =>
                imageIndex === index ? { ...image, url } : image,
              ),
            );
          }
        } catch (reason) {
          failures += 1;
          console.error("Unable to load thumbnail:", reason);
          if (active) {
            setPageImages((previous) =>
              previous.map((image, imageIndex) =>
                imageIndex === index ? { ...image, failed: true } : image,
              ),
            );
          }
        } finally {
          completed += 1;
          if (active && completed === currentMetadata.length) {
            setLoadingPage(false);
            if (failures > 0) {
              setWarning(
                `${failures} image${failures === 1 ? "" : "s"} could not be loaded.`,
              );
            }
          }
        }
      }
    }

    void Promise.all(
      Array.from(
        { length: Math.min(URL_CONCURRENCY, currentMetadata.length) },
        () => worker(),
      ),
    );

    return () => {
      active = false;
    };
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
      const response = await fetch(await getImageUrl(image.path));
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);

      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = image.name || "archive-image";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (caughtError) {
      console.error("Unable to download image:", caughtError);
      window.open(await getImageUrl(image.path), "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  const firstResult = filteredImages.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastResult = Math.min(page * PAGE_SIZE, filteredImages.length);

  return (
    <>
      {showLoadingScreen && (
        <div className="archive-loading-screen" role="status" aria-live="polite">
          <div className="archive-loading-card">
            <div className="spinner" aria-hidden="true" />
            <h2>Loading Image Archive</h2>
            <p>Preparing the first results. The remaining archive will continue indexing in the background.</p>
            <div className="archive-loading-progress" aria-hidden="true" />
          </div>
        </div>
      )}

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
            <div className="result-count"><span>{indexingArchive ? "Indexed so far" : "Results"}</span><strong>{filteredImages.length.toLocaleString()}</strong></div>
            {indexingArchive && <div className="indexing-note">Archive available. Indexing remaining files in the background...</div>}
          </div>
        </aside>

        <main className="main-content">
          <header className="top-header"><div><h1>Image Archive</h1><p>People. Photographs. A brighter tomorrow.</p></div></header>

          {error ? (
            <div className="status error"><strong>Archive unavailable</strong><p>{error}</p></div>
          ) : (
            <div className={selected ? "content-layout details-open" : "content-layout"}>
              <section className="results-area">
                <div className="results-toolbar">
                  <div className="results-summary"><strong>{filteredImages.length.toLocaleString()} {indexingArchive ? "indexed" : "results"}</strong>{filteredImages.length > 0 && <span>Showing {firstResult} to {lastResult}</span>}</div>
                  <nav className="pagination" aria-label="Archive pagination">
                    <button type="button" onClick={() => changePage(page - 1)} disabled={page === 1}>Previous</button>
                    <span>Page <strong>{page}</strong> of <strong>{totalPages}</strong></span>
                    <button type="button" onClick={() => changePage(page + 1)} disabled={page === totalPages}>Next</button>
                  </nav>
                </div>

                {warning && <div className="warning">{warning}</div>}

                {filteredImages.length === 0 ? (
                  <div className="status"><strong>No images found</strong><p>{indexingArchive ? "More archive files are still being indexed." : "Change the search, collection, or category."}</p></div>
                ) : (
                  <div className="image-grid">
                    {pageImages.map((image, index) => (
                      <button key={image.path} type="button" className={selected?.path === image.path ? "image-card selected" : "image-card"} onClick={() => image.url && setSelected(image)} disabled={!image.url}>
                        <div className="thumbnail">
                          {image.url && BROWSER_IMAGE.test(image.path) ? (
                            <img src={image.url} alt={image.name} loading={index < 4 ? "eager" : "lazy"} decoding="async" fetchPriority={index < 4 ? "high" : "auto"} />
                          ) : image.failed ? (
                            <div className="no-preview">Unavailable</div>
                          ) : (
                            <div className="thumbnail-skeleton" aria-hidden="true" />
                          )}
                        </div>
                        <div className="card-details"><strong title={image.name}>{image.name}</strong><span>{image.collection}</span><span>{image.category}</span><small>{image.lastModified ? image.lastModified.toLocaleDateString() : "Date unavailable"}</small></div>
                      </button>
                    ))}
                  </div>
                )}

                <nav className="bottom-pagination" aria-label="Bottom pagination">
                  <button type="button" onClick={() => changePage(page - 1)} disabled={page === 1}>Previous</button>
                  <span>{loadingPage ? "Loading thumbnails..." : `Page ${page} of ${totalPages}`}</span>
                  <button type="button" onClick={() => changePage(page + 1)} disabled={page === totalPages}>Next</button>
                </nav>
              </section>

              {selected && (
                <aside className="details-panel">
                  <div className="details-header"><strong title={selected.name}>{selected.name}</strong><button type="button" onClick={() => setSelected(null)} aria-label="Close details panel">x</button></div>
                  <div className="details-preview">{selected.url && <img src={selected.url} alt={selected.name} />}</div>
                  <div className="details-actions">
                    <button type="button" className="download-button" disabled={downloading} onClick={() => void downloadImage(selected)}>{downloading ? "Downloading..." : "Download"}</button>
                    <a href={selected.url} target="_blank" rel="noreferrer">Open original</a>
                  </div>
                  <dl className="metadata">
                    <div><dt>Filename</dt><dd>{selected.name}</dd></div>
                    <div><dt>Collection</dt><dd>{selected.collection}</dd></div>
                    <div><dt>Category</dt><dd>{selected.category}</dd></div>
                    <div><dt>Folder</dt><dd>{selected.folder}</dd></div>
                    <div><dt>File size</dt><dd>{formatBytes(selected.size)}</dd></div>
                  </dl>
                </aside>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
