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

const ARCHIVE_PATH = "Key Manifest/";
const S3_BUCKET = { bucketName: "manifest-inventory", region: "us-east-1" };
const PAGE_SIZE = 24;
const URL_EXPIRATION_SECONDS = 3600;
const ALL_COLLECTIONS = "All collections";
const ALL_CATEGORIES = "All categories";
const UNCATEGORIZED = "Uncategorized";
const IMAGE_FILE = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;
const BROWSER_IMAGE = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

function relativeParts(path: string): string[] {
  const relative = path.startsWith(ARCHIVE_PATH)
    ? path.slice(ARCHIVE_PATH.length)
    : path;
  return relative.split("/").filter(Boolean);
}

function toArchiveImage(item: {
  path: string;
  size?: number;
  lastModified?: Date;
}): ArchiveImage {
  const parts = relativeParts(item.path);
  return {
    path: item.path,
    name: parts.at(-1) || item.path,
    collection: parts.length > 1 ? parts[0] : UNCATEGORIZED,
    category: parts.length > 2 ? parts[1] : UNCATEGORIZED,
    folder: parts.length > 1 ? parts.slice(0, -1).join(" / ") : UNCATEGORIZED,
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
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const urlCache = useRef<Map<string, string>>(new Map());

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
          .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, {
              numeric: true,
              sensitivity: "base",
            }),
          );
        if (active) setImages(metadata);
      } catch (caughtError) {
        console.error("Unable to list archive images:", caughtError);
        if (active) {
          setError(
            `Unable to load images from "${ARCHIVE_PATH}". Check the S3 prefix and Amplify Storage permissions.`,
          );
        }
      } finally {
        if (active) setLoadingArchive(false);
      }
    }

    void loadArchive();
    return () => {
      active = false;
    };
  }, []);

  const collections = useMemo(
    () =>
      Array.from(new Set(images.map((image) => image.collection))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [images],
  );

  const categories = useMemo(() => {
    const scoped =
      collection === ALL_COLLECTIONS
        ? images
        : images.filter((image) => image.collection === collection);
    return Array.from(new Set(scoped.map((image) => image.category))).sort(
      (a, b) => a.localeCompare(b),
    );
  }, [images, collection]);

  const filteredImages = useMemo(() => {
    const query = search.trim().toLowerCase();
    return images.filter((image) => {
      if (collection !== ALL_COLLECTIONS && image.collection !== collection) {
        return false;
      }
      if (category !== ALL_CATEGORIES && image.category !== category) {
        return false;
      }
      if (!query) return true;
      return [image.name, image.collection, image.category, image.folder, image.path]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [images, search, collection, category]);

  const totalPages = Math.max(1, Math.ceil(filteredImages.length / PAGE_SIZE));
  const currentMetadata = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredImages.slice(start, start + PAGE_SIZE);
  }, [filteredImages, page]);

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

  useEffect(() => {
    let active = true;

    async function loadPage(): Promise<void> {
      if (currentMetadata.length === 0) {
        setPageImages([]);
        setWarning("");
        return;
      }

      try {
        setLoadingPage(true);
        setWarning("");
        const results = await Promise.allSettled(
          currentMetadata.map(async (image): Promise<DisplayImage> => {
            const cached = urlCache.current.get(image.path);
            if (cached) return { ...image, url: cached };
            const result = await getUrl({
              path: image.path,
              options: { bucket: S3_BUCKET, expiresIn: URL_EXPIRATION_SECONDS },
            });
            const url = result.url.toString();
            urlCache.current.set(image.path, url);
            return { ...image, url };
          }),
        );
        const loaded: DisplayImage[] = [];
        let failures = 0;
        for (const result of results) {
          if (result.status === "fulfilled") loaded.push(result.value);
          else failures += 1;
        }
        if (active) {
          setPageImages(loaded);
          if (failures) {
            setWarning(`${failures} image${failures === 1 ? "" : "s"} could not be loaded.`);
          }
        }
      } catch (caughtError) {
        console.error("Unable to load page:", caughtError);
        if (active) setWarning("Unable to load the current page.");
      } finally {
        if (active) setLoadingPage(false);
      }
    }

    void loadPage();
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

  const firstResult = filteredImages.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastResult = Math.min(page * PAGE_SIZE, filteredImages.length);

  return (
    <div className="archive-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">ICP</div>
          <div>
            <strong>Image Archive</strong>
            <span>Digital Collection</span>
          </div>
        </div>

        <div className="static-filters">
          <label htmlFor="archive-search">Search archive</label>
          <input
            id="archive-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filename, folder, collection..."
          />

          <label htmlFor="collection-filter">Collection</label>
          <select
            id="collection-filter"
            value={collection}
            onChange={(event) => setCollection(event.target.value)}
          >
            <option value={ALL_COLLECTIONS}>All collections</option>
            {collections.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <label htmlFor="category-filter">Category</label>
          <select
            id="category-filter"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value={ALL_CATEGORIES}>All categories</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>

          <button type="button" className="clear-button" onClick={clearFilters}>
            Clear filters
          </button>

          <div className="result-count">
            <span>Results</span>
            <strong>{filteredImages.length.toLocaleString()}</strong>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-header">
          <div>
            <h1>Image Archive</h1>
            <p>People. Photographs. A brighter tomorrow.</p>
          </div>
        </header>

        {loadingArchive ? (
          <div className="status">
            <div className="spinner" aria-hidden="true" />
            <strong>Loading archive...</strong>
          </div>
        ) : error ? (
          <div className="status error">
            <strong>Archive unavailable</strong>
            <p>{error}</p>
          </div>
        ) : (
          <div className={selected ? "content-layout details-open" : "content-layout"}>
            <section className="results-area">
              <div className="results-toolbar">
                <div className="results-summary">
                  <strong>{filteredImages.length.toLocaleString()} results</strong>
                  {filteredImages.length > 0 && (
                    <span>
                      Showing {firstResult} to {lastResult}
                    </span>
                  )}
                </div>

                <nav className="pagination" aria-label="Archive pagination">
                  <button
                    type="button"
                    onClick={() => changePage(page - 1)}
                    disabled={page === 1 || loadingPage}
                  >
                    Previous
                  </button>
                  <span>
                    Page <strong>{page}</strong> of <strong>{totalPages}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => changePage(page + 1)}
                    disabled={page === totalPages || loadingPage}
                  >
                    Next
                  </button>
                </nav>
              </div>

              {warning && <div className="warning">{warning}</div>}

              {filteredImages.length === 0 ? (
                <div className="status">
                  <strong>No images found</strong>
                  <p>Change the search, collection, or category.</p>
                </div>
              ) : loadingPage ? (
                <div className="status">
                  <div className="spinner" aria-hidden="true" />
                  <strong>Loading page {page}...</strong>
                </div>
              ) : (
                <div className="image-grid">
                  {pageImages.map((image) => (
                    <button
                      key={image.path}
                      type="button"
                      className={
                        selected?.path === image.path
                          ? "image-card selected"
                          : "image-card"
                      }
                      onClick={() => setSelected(image)}
                    >
                      <div className="thumbnail">
                        {BROWSER_IMAGE.test(image.path) ? (
                          <img
                            src={image.url}
                            alt={image.name}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="no-preview">TIFF</div>
                        )}
                      </div>
                      <div className="card-details">
                        <strong title={image.name}>{image.name}</strong>
                        <span>{image.collection}</span>
                        <span>{image.category}</span>
                        <small>
                          {image.lastModified
                            ? image.lastModified.toLocaleDateString()
                            : "Date unavailable"}
                        </small>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {filteredImages.length > 0 && (
                <nav className="bottom-pagination" aria-label="Bottom pagination">
                  <button
                    type="button"
                    onClick={() => changePage(page - 1)}
                    disabled={page === 1 || loadingPage}
                  >
                    Previous
                  </button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => changePage(page + 1)}
                    disabled={page === totalPages || loadingPage}
                  >
                    Next
                  </button>
                </nav>
              )}
            </section>

            {selected && (
              <aside className="details-panel">
                <div className="details-header">
                  <strong title={selected.name}>{selected.name}</strong>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label="Close details panel"
                  >
                    ×
                  </button>
                </div>

                <div className="details-preview">
                  {BROWSER_IMAGE.test(selected.path) ? (
                    <img src={selected.url} alt={selected.name} />
                  ) : (
                    <div className="no-preview">TIFF preview unavailable</div>
                  )}
                </div>

                <div className="details-actions">
                  <a href={selected.url} target="_blank" rel="noreferrer">
                    Open original
                  </a>
                </div>

                <dl className="metadata">
                  <div>
                    <dt>Filename</dt>
                    <dd>{selected.name}</dd>
                  </div>
                  <div>
                    <dt>Collection</dt>
                    <dd>{selected.collection}</dd>
                  </div>
                  <div>
                    <dt>Category</dt>
                    <dd>{selected.category}</dd>
                  </div>
                  <div>
                    <dt>Folder</dt>
                    <dd>{selected.folder}</dd>
                  </div>
                  <div>
                    <dt>File size</dt>
                    <dd>{formatBytes(selected.size)}</dd>
                  </div>
                  <div>
                    <dt>Modified</dt>
                    <dd>
                      {selected.lastModified
                        ? selected.lastModified.toLocaleDateString()
                        : "Unavailable"}
                    </dd>
                  </div>
                </dl>
              </aside>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
