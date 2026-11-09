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
    url: string;
};

const ARCHIVE_PATH = "Key Manifest/";

const S3_BUCKET = {
    bucketName: "manifest-inventory",
    region: "us-east-1",
};

const PAGE_SIZE = 24;
const URL_EXPIRATION = 3600;

const ALL_COLLECTIONS = "All collections";
const ALL_CATEGORIES = "All categories";
const UNCATEGORIZED = "Uncategorized";

const IMAGE_FILE = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;
const BROWSER_IMAGE = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

function getFileName(path: string): string {
    return path.split("/").pop() || path;
}

function getRelativeParts(path: string): string[] {
    const relativePath = path.startsWith(ARCHIVE_PATH)
        ? path.slice(ARCHIVE_PATH.length)
        : path;

    return relativePath.split("/").filter(Boolean);
}

function getCollection(path: string): string {
    const parts = getRelativeParts(path);

    if (parts.length <= 1) {
        return UNCATEGORIZED;
    }

    return parts[0];
}

function getCategory(path: string): string {
    const parts = getRelativeParts(path);

    if (parts.length <= 2) {
        return UNCATEGORIZED;
    }

    return parts[1];
}

function getFolder(path: string): string {
    const parts = getRelativeParts(path);

    if (parts.length <= 1) {
        return UNCATEGORIZED;
    }

    parts.pop();

    return parts.join(" / ");
}

function canPreview(path: string): boolean {
    return BROWSER_IMAGE.test(path);
}

function formatBytes(bytes?: number): string {
    if (bytes === undefined) {
        return "Unknown";
    }

    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function App() {
    const [images, setImages] = useState<ArchiveImage[]>([]);
    const [pageImages, setPageImages] = useState<DisplayImage[]>([]);

    const [search, setSearch] = useState("");
    const [collection, setCollection] = useState(ALL_COLLECTIONS);
    const [category, setCategory] = useState(ALL_CATEGORIES);

    const [page, setPage] = useState(1);

    const [selected, setSelected] =
        useState<DisplayImage | null>(null);

    const [loadingArchive, setLoadingArchive] = useState(true);
    const [loadingPage, setLoadingPage] = useState(false);

    const [error, setError] = useState("");
    const [warning, setWarning] = useState("");

    const urlCache = useRef<Map<string, string>>(new Map());

    useEffect(() => {
        let cancelled = false;

        async function loadArchive(): Promise<void> {
            try {
                setLoadingArchive(true);
                setError("");

                const result = await list({
                    path: ARCHIVE_PATH,
                    options: {
                        listAll: true,
                        bucket: S3_BUCKET,
                    },
                });

                const archiveImages: ArchiveImage[] = result.items
                    .filter((item) => IMAGE_FILE.test(item.path))
                    .map((item) => ({
                        path: item.path,
                        name: getFileName(item.path),
                        collection: getCollection(item.path),
                        category: getCategory(item.path),
                        folder: getFolder(item.path),
                        size: item.size,
                        lastModified: item.lastModified,
                    }))
                    .sort((a, b) =>
                        a.name.localeCompare(b.name, undefined, {
                            numeric: true,
                            sensitivity: "base",
                        }),
                    );

                if (!cancelled) {
                    setImages(archiveImages);
                }
            } catch (err) {
                console.error("Failed to load archive:", err);

                if (!cancelled) {
                    setError(
                        `Unable to load images from "${ARCHIVE_PATH}". Check the S3 prefix and Amplify Storage permissions.`,
                    );
                }
            } finally {
                if (!cancelled) {
                    setLoadingArchive(false);
                }
            }
        }

        void loadArchive();

        return () => {
            cancelled = true;
        };
    }, []);

    const collections = useMemo(() => {
        const values = Array.from(
            new Set(images.map((image) => image.collection)),
        );

        return values.sort((a, b) => a.localeCompare(b));
    }, [images]);

    const categories = useMemo(() => {
        const sourceImages =
            collection === ALL_COLLECTIONS
                ? images
                : images.filter(
                    (image) => image.collection === collection,
                );

        const values = Array.from(
            new Set(sourceImages.map((image) => image.category)),
        );

        return values.sort((a, b) => a.localeCompare(b));
    }, [images, collection]);

    const filteredImages = useMemo(() => {
        const query = search.trim().toLowerCase();

        return images.filter((image) => {
            const collectionMatches =
                collection === ALL_COLLECTIONS ||
                image.collection === collection;

            if (!collectionMatches) {
                return false;
            }

            const categoryMatches =
                category === ALL_CATEGORIES ||
                image.category === category;

            if (!categoryMatches) {
                return false;
            }

            if (!query) {
                return true;
            }

            const text = [
                image.name,
                image.collection,
                image.category,
                image.folder,
                image.path,
            ]
                .join(" ")
                .toLowerCase();

            return text.includes(query);
        });
    }, [images, search, collection, category]);

    const totalPages = Math.max(
        1,
        Math.ceil(filteredImages.length / PAGE_SIZE),
    );

    useEffect(() => {
        setPage(1);
        setSelected(null);
    }, [search, collection, category]);

    useEffect(() => {
        setCategory(ALL_CATEGORIES);
    }, [collection]);

    useEffect(() => {
        if (page > totalPages) {
            setPage(totalPages);
        }
    }, [page, totalPages]);

    const currentPageItems = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        const end = start + PAGE_SIZE;

        return filteredImages.slice(start, end);
    }, [filteredImages, page]);

    useEffect(() => {
        let cancelled = false;

        async function loadPageImages(): Promise<void> {
            if (currentPageItems.length === 0) {
                setPageImages([]);
                setWarning("");
                setLoadingPage(false);
                return;
            }

            try {
                setLoadingPage(true);
                setWarning("");

                const results = await Promise.allSettled(
                    currentPageItems.map(
                        async (image): Promise<DisplayImage> => {
                            const cached = urlCache.current.get(image.path);

                            if (cached) {
                                return {
                                    ...image,
                                    url: cached,
                                };
                            }

                            const result = await getUrl({
                                path: image.path,
                                options: {
                                    bucket: S3_BUCKET,
                                    expiresIn: URL_EXPIRATION,
                                },
                            });

                            const url = result.url.toString();

                            urlCache.current.set(image.path, url);

                            return {
                                ...image,
                                url,
                            };
                        },
                    ),
                );

                const successfulImages: DisplayImage[] = [];
                let failureCount = 0;

                for (const result of results) {
                    if (result.status === "fulfilled") {
                        successfulImages.push(result.value);
                    } else {
                        failureCount += 1;
                        console.error(result.reason);
                    }
                }

                if (!cancelled) {
                    setPageImages(successfulImages);

                    if (failureCount > 0) {
                        setWarning(
                            `${failureCount} image${failureCount === 1 ? "" : "s"
                            } could not be loaded.`,
                        );
                    }
                }
            } catch (err) {
                console.error("Failed to load page:", err);

                if (!cancelled) {
                    setPageImages([]);
                    setWarning("Unable to load the current page.");
                }
            } finally {
                if (!cancelled) {
                    setLoadingPage(false);
                }
            }
        }

        void loadPageImages();

        return () => {
            cancelled = true;
        };
    }, [currentPageItems]);

    function previousPage(): void {
        setPage((current) => Math.max(1, current - 1));
        setSelected(null);

        window.scrollTo({
            top: 0,
            behavior: "smooth",
        });
    }

    function nextPage(): void {
        setPage((current) =>
            Math.min(totalPages, current + 1),
        );

        setSelected(null);

        window.scrollTo({
            top: 0,
            behavior: "smooth",
        });
    }

    function clearFilters(): void {
        setSearch("");
        setCollection(ALL_COLLECTIONS);
        setCategory(ALL_CATEGORIES);
        setPage(1);
        setSelected(null);
    }

    const firstResult =
        filteredImages.length === 0
            ? 0
            : (page - 1) * PAGE_SIZE + 1;

    const lastResult = Math.min(
        page * PAGE_SIZE,
        filteredImages.length,
    );

    return (
        <div className= "archive-shell" >
        <aside className="sidebar" >
            <div className="brand" >
                <strong>ICP </strong>

                < div >
                <span>Image Archive </span>
                    < small > Digital Collection </small>
                        </div>
                        </div>

                        < div className = "filters" >
                            <h2>Browse Archive </h2>

                                < label htmlFor = "archive-search" >
                                    Search
                                    </label>

                                    < input
    id = "archive-search"
    type = "search"
    value = { search }
    onChange = {(event) =>
    setSearch(event.target.value)
}
placeholder = "Filename or folder..."
autoComplete = "off"
    />

    <label htmlFor="collection-filter" >
        Collection
        </label>

        < select
id = "collection-filter"
value = { collection }
onChange = {(event) =>
setCollection(event.target.value)
            }
          >
    <option value={ ALL_COLLECTIONS }>
        All collections
            </option>

{
    collections.map((value) => (
        <option key= { value } value = { value } >
        { value }
        </option>
    ))
}
</select>

    < label htmlFor = "category-filter" >
        Category
        </label>

        < select
id = "category-filter"
value = { category }
onChange = {(event) =>
setCategory(event.target.value)
            }
          >
    <option value={ ALL_CATEGORIES }>
        All categories
            </option>

{
    categories.map((value) => (
        <option key= { value } value = { value } >
        { value }
        </option>
    ))
}
</select>

    < button
type = "button"
className = "clear-button"
onClick = { clearFilters }
    >
    Clear filters
        </button>

        < div className = "result-count" >
            <span>Results </span>

            <strong>
{ filteredImages.length.toLocaleString() }
</strong>
    </div>
    </div>
    </aside>

    < main className = "main-content" >
        <header className="top-header" >
            <div>
            <h1>Image Archive </h1>
                < p > Browse the digital collection </p>
                    </div>
                    </header>

{
    loadingArchive ? (
        <div className= "status" >
        <div
              className="spinner"
    aria - hidden="true"
        />

        <strong>Loading archive...</strong>
            </div>
        ) : error ? (
        <div className= "status error" >
        <strong>Archive unavailable </strong>
            < p > { error } </p>
            </div>
        ) : (
        <div
            className= {
            selected
            ? "content-layout details-open"
                : "content-layout"
        }
        >
        <section className="results-area" >
            <div className="results-toolbar" >
                <div className="results-summary" >
                    <strong>
                    { filteredImages.length.toLocaleString() } results
                        </strong>

    {
        filteredImages.length > 0 && (
            <span>
            Showing { firstResult } to { lastResult }
        </span>
                  )
    }
    </div>

        < nav
    className = "pagination"
    aria - label="Archive pagination"
        >
        <button
                    type="button"
    onClick = { previousPage }
    disabled = {
        page === 1 ||
        loadingPage
}
                  >
    Previous
    </button>

    <span>
Page < strong > { page } </strong> of{" "}
    < strong > { totalPages } </strong>
    </span>

    < button
type = "button"
onClick = { nextPage }
disabled = {
    page === totalPages ||
    loadingPage
                    }
                  >
    Next
    </button>
    </nav>
    </div>

{
    warning && (
        <div className="warning" >
        { warning }
            </div>
              )
}

{
    filteredImages.length === 0 ? (
        <div className= "status" >
        <strong>No images found </strong>

            <p>
                    Change the search, collection, or category.
                  </p>
        </div>
              ) : loadingPage ? (
        <div className= "status" >
        <div
                    className="spinner"
    aria - hidden="true"
        />

        <strong>
        Loading page { page }...
    </strong>
        </div>
              ) : (
        <div className= "image-grid" >
        {
            pageImages.map((image) => (
                <button
                      key= { image.path }
                      type = "button"
                      className = {
                    selected?.path === image.path
                    ? "image-card selected"
                    : "image-card"
                      }
    onClick = {() => setSelected(image)
}
                    >
    <div className="thumbnail" >
        { canPreview(image.path) ? (
            <img
                            src={ image.url }
                            alt = { image.name }
                            loading = "lazy"
                            decoding = "async"
            />
                        ) : (
    <div className= "no-preview" >
    TIFF
    </div>
                        )}
</div>

    < div className = "card-details" >
        <strong title={ image.name }>
        { image.name }
            </strong>

            < span > { image.collection } </span>
            < span > { image.category } </span>

            <small>
{
    image.lastModified
    ? image.lastModified.toLocaleDateString()
    : "Date unavailable"
}
</small>
    </div>
    </button>
                  ))}
</div>
              )}

{
    filteredImages.length > 0 && (
        <nav
                  className="bottom-pagination"
    aria - label="Bottom pagination"
        >
        <button
                    type="button"
    onClick = { previousPage }
    disabled = {
        page === 1 ||
        loadingPage
}
                  >
    Previous
    </button>

    <span>
                    Page { page } of { totalPages }
</span>

    < button
type = "button"
onClick = { nextPage }
disabled = {
    page === totalPages ||
    loadingPage
                    }
                  >
    Next
    </button>
    </nav>
              )}
</section>

{
    selected && (
        <aside className="details-panel" >
            <div className="details-header" >
                <strong title={ selected.name }>
                { selected.name }
                    </strong>

                    < button
    type = "button"
    onClick = {() => setSelected(null)
}
aria - label="Close details panel"
    >
                    ×
</button>
    </div>

    < div className = "details-preview" >
        { canPreview(selected.path) ? (
            <img
                      src={ selected.url }
                      alt = { selected.name }
            />
                  ) : (
    <div className= "no-preview" >
    TIFF preview unavailable
        </div>
                  )}
</div>

    < div className = "details-actions" >
        <a
                    href={ selected.url }
target = "_blank"
rel = "noreferrer"
    >
    Open original
        </a>
        </div>

        < dl className = "metadata" >
            <div>
            <dt>Filename </dt>
            < dd > { selected.name } </dd>
            </div>

            < div >
            <dt>Collection </dt>
            < dd > { selected.collection } </dd>
            </div>

            < div >
            <dt>Category </dt>
            < dd > { selected.category } </dd>
            </div>

            < div >
            <dt>Folder </dt>
            < dd > { selected.folder } </dd>
            </div>

            < div >
            <dt>File size </dt>
                < dd > { formatBytes(selected.size) } </dd>
                </div>

                < div >
                <dt>Modified </dt>
                <dd>
{
    selected.lastModified
    ? selected.lastModified.toLocaleDateString()
    : "Unavailable"
}
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
