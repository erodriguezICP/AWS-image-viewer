import { useEffect, useMemo, useRef, useState } from "react";
import { getUrl, list } from "aws-amplify/storage";
import "./App.css";

type ArchiveImage = {
  path: string;
  name: string;
  size?: number;
  lastModified?: Date;
};

type ArchiveImageWithUrl = ArchiveImage & {
  url: string;
};

const ARCHIVE_PATH = "Key Manifest/";

const S3_BUCKET = {
  bucketName: "manifest-inventory",
  region: "us-east-1",
};

const IMAGE_FILE = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;

const PAGE_SIZE = 24;
const URL_EXPIRATION_SECONDS = 3600;

function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isBrowserDisplayableImage(path: string): boolean {
  return /\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(path);
}

export default function App() {
  const [images, setImages] = useState<ArchiveImage[]>([]);
  const [displayImages, setDisplayImages] = useState<ArchiveImageWithUrl[]>([]);

  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [selected, setSelected] =
    useState<ArchiveImageWithUrl | null>(null);

  const [loadingArchive, setLoadingArchive] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);

  const [archiveError, setArchiveError] = useState("");
  const [pageError, setPageError] = useState("");

  const urlCache = useRef<Map<string, string>>(new Map());

  /*
   * STEP 1
   *
   * List the S3 objects.
   *
   * IMPORTANT:
   * This does NOT generate a signed URL for every object.
   * The original application generated hundreds of URLs at once.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadArchive() {
      try {
        setLoadingArchive(true);
        setArchiveError("");

        const result = await list({
          path: ARCHIVE_PATH,
          options: {
            listAll: true,
            bucket: S3_BUCKET,
          },
        });

        const foundImages: ArchiveImage[] = result.items
          .filter((item) => IMAGE_FILE.test(item.path))
          .map((item) => ({
            path: item.path,
            name: getFileName(item.path),
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
          setImages(foundImages);
        }
      } catch (error) {
        console.error("Unable to list archive:", error);

        if (!cancelled) {
          setArchiveError(
            `Unable to load the archive from "${ARCHIVE_PATH}". ` +
              "Verify the S3 prefix, bucket name, region, and Amplify Storage permissions.",
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

  /*
   * STEP 2
   *
   * Search against the metadata.
   *
   * Searching does not download hundreds of images.
   */
  const filteredImages = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return images;
    }

    return images.filter((image) => {
      const searchableText = `${image.name} ${image.path}`.toLowerCase();

      return searchableText.includes(query);
    });
  }, [images, search]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredImages.length / PAGE_SIZE),
  );

  /*
   * Reset pagination when a new search is entered.
   */
  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  /*
   * Prevent the current page from being outside the valid range.
   */
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  /*
   * STEP 3
   *
   * Only take 24 records for the current page.
   */
  const currentPageImages = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    return filteredImages.slice(start, end);
  }, [filteredImages, currentPage]);

  /*
   * STEP 4
   *
   * Generate S3 URLs ONLY for the images on the current page.
   *
   * This is the main fix for the previous hundreds-of-requests problem.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadPageImages() {
      if (currentPageImages.length === 0) {
        setDisplayImages([]);
        return;
      }

      try {
        setLoadingPage(true);
        setPageError("");

        const results = await Promise.allSettled(
          currentPageImages.map(
            async (image): Promise<ArchiveImageWithUrl> => {
              /*
               * Reuse an existing URL if this image has already
               * been loaded during this session.
               */
              const cachedUrl = urlCache.current.get(image.path);

              if (cachedUrl) {
                return {
                  ...image,
                  url: cachedUrl,
                };
              }

              /*
               * Ask Amplify for the signed URL.
               */
              const result = await getUrl({
                path: image.path,
                options: {
                  bucket: S3_BUCKET,
                  expiresIn: URL_EXPIRATION_SECONDS,
                },
              });

              const url = result.url.toString();

              /*
               * Store it so going back to this page does not
               * immediately generate another signed URL.
               */
              urlCache.current.set(image.path, url);

              return {
                ...image,
                url,
              };
            },
          ),
        );

        const successful: ArchiveImageWithUrl[] = [];

        let failures = 0;

        for (const result of results) {
          if (result.status === "fulfilled") {
            successful.push(result.value);
          } else {
            failures += 1;
            console.error(
              "Unable to generate image URL:",
              result.reason,
            );
          }
        }

        if (!cancelled) {
          setDisplayImages(successful);

          if (failures > 0) {
            setPageError(
              `${failures} image${
                failures === 1 ? "" : "s"
              } on this page could not be loaded.`,
            );
          }
        }
      } catch (error) {
        console.error("Unable to load current page:", error);

        if (!cancelled) {
          setDisplayImages([]);
          setPageError(
            "Unable to generate image URLs for this page.",
          );
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
  }, [currentPageImages]);

  /*
   * Allow Escape to close the lightbox.
   */
  useEffect(() => {
    if (!selected) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelected(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selected]);

  function previousPage() {
    setCurrentPage((page) => Math.max(1, page - 1));
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function nextPage() {
    setCurrentPage((page) =>
      Math.min(totalPages, page + 1),
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  return (
    <div className="archive-app">
      <header className="archive-header">
        <div className="header-content">
          <p className="eyebrow">Digital Collection</p>

          <h1>Archive Image Viewer</h1>

          <p className="header-description">
            Search the archive and select a thumbnail to view
            the full image.
          </p>
        </div>
      </header>

      <main className="archive-main">
        <section className="archive-controls">
          <div className="search-container">
            <label htmlFor="archive-search">
              Search archive
            </label>

            <input
              id="archive-search"
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search by filename..."
            />
          </div>

          <div className="archive-count">
            <strong>{filteredImages.length}</strong>
            <span>
              {" "}
              of {images.length} images
            </span>
          </div>
        </section>

        {loadingArchive && (
          <div className="status-panel">
            <div
              className="spinner"
              aria-hidden="true"
            />

            <p>Loading archive records...</p>
          </div>
        )}

        {!loadingArchive && archiveError && (
          <div
            className="status-panel error-panel"
            role="alert"
          >
            <strong>Archive unavailable</strong>
            <p>{archiveError}</p>
          </div>
        )}

        {!loadingArchive &&
          !archiveError &&
          filteredImages.length === 0 && (
            <div className="status-panel">
              <strong>No images found</strong>

              <p>
                {images.length === 0
                  ? `No supported image files were found under "${ARCHIVE_PATH}".`
                  : `No archive images match "${search}".`}
              </p>
            </div>
          )}

        {!loadingArchive &&
          !archiveError &&
          filteredImages.length > 0 && (
            <>
              <div className="results-toolbar">
                <div>
                  Page{" "}
                  <strong>{currentPage}</strong>
                  {" "}of{" "}
                  <strong>{totalPages}</strong>
                </div>

                <div className="page-range">
                  Showing{" "}
                  {(currentPage - 1) * PAGE_SIZE + 1}
                  {" - "}
                  {Math.min(
                    currentPage * PAGE_SIZE,
                    filteredImages.length,
                  )}
                </div>
              </div>

              {pageError && (
                <div
                  className="page-warning"
                  role="status"
                >
                  {pageError}
                </div>
              )}

              {loadingPage ? (
                <div className="status-panel">
                  <div
                    className="spinner"
                    aria-hidden="true"
                  />
                  <p>
                    Loading page {currentPage}...
                  </p>
                </div>
              ) : (
                <section
                  className="image-grid"
                  aria-label="Archive images"
                >
                  {displayImages.map((image) => (
                    <button
                      key={image.path}
                      className="image-card"
                      type="button"
                      onClick={() =>
                        setSelected(image)
                      }
                      aria-label={`Open ${image.name}`}
                    >
                      <div className="thumbnail-container">
                        {isBrowserDisplayableImage(
                          image.path,
                        ) ? (
                          <img
                            src={image.url}
                            alt={image.name}
                            loading="lazy"
                            decoding="async"
                            onError={(event) => {
                              console.error(
                                "Browser failed to display:",
                                image.path,
                              );

                              event.currentTarget.classList.add(
                                "image-load-error",
                              );
                            }}
                          />
                        ) : (
                          <div className="unsupported-preview">
                            <span>TIFF</span>
                            <small>
                              Open image to view original
                            </small>
                          </div>
                        )}
                      </div>

                      <div className="image-info">
                        <strong
                          className="image-name"
                          title={image.name}
                        >
                          {image.name}
                        </strong>

                        <div className="image-metadata">
                          <span>
                            {image.lastModified
                              ? image.lastModified.toLocaleDateString()
                              : "Date unavailable"}
                          </span>

                          {image.size !== undefined && (
                            <span>
                              {formatBytes(image.size)}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </section>
              )}

              <nav
                className="pagination"
                aria-label="Archive pagination"
              >
                <button
                  type="button"
                  className="pagination-button"
                  onClick={previousPage}
                  disabled={
                    currentPage === 1 ||
                    loadingPage
                  }
                >
                  Previous
                </button>

                <div className="pagination-status">
                  <span>Page</span>
                  <strong>{currentPage}</strong>
                  <span>of</span>
                  <strong>{totalPages}</strong>
                </div>

                <button
                  type="button"
                  className="pagination-button"
                  onClick={nextPage}
                  disabled={
                    currentPage === totalPages ||
                    loadingPage
                  }
                >
                  Next
                </button>
              </nav>
            </>
          )}
      </main>

      {selected && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Viewing ${selected.name}`}
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget
            ) {
              setSelected(null);
            }
          }}
        >
          <div className="lightbox-content">
            <div className="lightbox-header">
              <div>
                <p className="lightbox-label">
                  Archive image
                </p>

                <strong>
                  {selected.name}
                </strong>
              </div>

              <button
                type="button"
                className="close-button"
                onClick={() => setSelected(null)}
                aria-label="Close image viewer"
              >
                ×
              </button>
            </div>

            <div className="lightbox-image-container">
              {isBrowserDisplayableImage(
                selected.path,
              ) ? (
                <img
                  src={selected.url}
                  alt={selected.name}
                />
              ) : (
                <div className="tiff-message">
                  <strong>
                    Browser preview unavailable
                  </strong>

                  <p>
                    This image is a TIFF file.
                    Download or open the original
                    to view it in a compatible
                    application.
                  </p>
                </div>
              )}
            </div>

            <div className="lightbox-footer">
              <div className="lightbox-details">
                {selected.lastModified && (
                  <span>
                    {selected.lastModified.toLocaleDateString()}
                  </span>
                )}

                {selected.size !== undefined && (
                  <span>
                    {formatBytes(selected.size)}
                  </span>
                )}
              </div>

              <a
                className="open-original"
                href={selected.url}
                target="_blank"
                rel="noreferrer"
              >
                Open original
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
