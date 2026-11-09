import { useEffect, useMemo, useRef, useState } from "react";
import { getUrl, list } from "aws-amplify/storage";
import "./App.css";

type ArchiveImage = {
  path: string;
  name: string;
  folder: string;
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
const BROWSER_IMAGE_FILE = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

const PAGE_SIZE = 24;
const URL_EXPIRATION_SECONDS = 3600;

const ALL_FOLDERS = "All folders";
const ROOT_FOLDER = "Uncategorized";

function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

function getFolderName(path: string): string {
  const relativePath = path.startsWith(ARCHIVE_PATH)
    ? path.slice(ARCHIVE_PATH.length)
    : path;

  const parts = relativePath.split("/").filter(Boolean);

  if (parts.length <= 1) {
    return ROOT_FOLDER;
  }

  parts.pop();

  return parts.join(" / ");
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

function canPreviewInBrowser(path: string): boolean {
  return BROWSER_IMAGE_FILE.test(path);
}

export default function App() {
  const [images, setImages] = useState<ArchiveImage[]>([]);
  const [pageImages, setPageImages] = useState<ArchiveImageWithUrl[]>([]);

  const [search, setSearch] = useState("");
  const [selectedFolder, setSelectedFolder] = useState(ALL_FOLDERS);
  const [currentPage, setCurrentPage] = useState(1);

  const [selectedImage, setSelectedImage] =
    useState<ArchiveImageWithUrl | null>(null);

  const [loadingArchive, setLoadingArchive] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);

  const [archiveError, setArchiveError] = useState("");
  const [pageWarning, setPageWarning] = useState("");

  const urlCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;

    async function loadArchive(): Promise<void> {
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

        const archiveImages: ArchiveImage[] = result.items
          .filter((item) => IMAGE_FILE.test(item.path))
          .map((item) => ({
            path: item.path,
            name: getFileName(item.path),
            folder: getFolderName(item.path),
            size: item.size,
            lastModified: item.lastModified,
          }))
          .sort((first, second) => {
            const folderComparison = first.folder.localeCompare(
              second.folder,
              undefined,
              {
                numeric: true,
                sensitivity: "base",
              },
            );

            if (folderComparison !== 0) {
              return folderComparison;
            }

            return first.name.localeCompare(
              second.name,
              undefined,
              {
                numeric: true,
                sensitivity: "base",
              },
            );
          });

        if (!cancelled) {
          setImages(archiveImages);
        }
      } catch (error) {
        console.error("Failed to load archive:", error);

        if (!cancelled) {
          setArchiveError(
            `Unable to load archive images from "${ARCHIVE_PATH}". Check the S3 prefix, bucket, region, and Amplify Storage permissions.`,
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

  const folders = useMemo(() => {
    const folderSet = new Set<string>();

    for (const image of images) {
      folderSet.add(image.folder);
    }

    const folderList = Array.from(folderSet);

    folderList.sort((first, second) =>
      first.localeCompare(second, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    return [ALL_FOLDERS, ...folderList];
  }, [images]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();

    counts.set(ALL_FOLDERS, images.length);

    for (const image of images) {
      const currentCount = counts.get(image.folder) ?? 0;

      counts.set(image.folder, currentCount + 1);
    }

    return counts;
  }, [images]);

  const filteredImages = useMemo(() => {
    const query = search.trim().toLowerCase();

    return images.filter((image) => {
      const matchesFolder =
        selectedFolder === ALL_FOLDERS ||
        image.folder === selectedFolder;

      if (!matchesFolder) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchableText = [
        image.name,
        image.folder,
        image.path,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    });
  }, [images, search, selectedFolder]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredImages.length / PAGE_SIZE),
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedFolder]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const currentPageMetadata = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const endIndex = startIndex + PAGE_SIZE;

    return filteredImages.slice(startIndex, endIndex);
  }, [filteredImages, currentPage]);

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentPage(): Promise<void> {
      if (currentPageMetadata.length === 0) {
        setPageImages([]);
        setPageWarning("");
        return;
      }

      try {
        setLoadingPage(true);
        setPageWarning("");

        const results = await Promise.allSettled(
          currentPageMetadata.map(
            async (image): Promise<ArchiveImageWithUrl> => {
              const cachedUrl = urlCache.current.get(image.path);

              if (cachedUrl) {
                return {
                  ...image,
                  url: cachedUrl,
                };
              }

              const result = await getUrl({
                path: image.path,
                options: {
                  bucket: S3_BUCKET,
                  expiresIn: URL_EXPIRATION_SECONDS,
                },
              });

              const signedUrl = result.url.toString();

              urlCache.current.set(image.path, signedUrl);

              return {
                ...image,
                url: signedUrl,
              };
            },
          ),
        );

        const successfulImages: ArchiveImageWithUrl[] = [];
        let failures = 0;

        for (const result of results) {
          if (result.status === "fulfilled") {
            successfulImages.push(result.value);
          } else {
            failures += 1;

            console.error(
              "Unable to generate signed image URL:",
              result.reason,
            );
          }
        }

        if (!cancelled) {
          setPageImages(successfulImages);

          if (failures > 0) {
            setPageWarning(
              `${failures} image${
                failures === 1 ? "" : "s"
              } could not be loaded on this page.`,
            );
          }
        }
      } catch (error) {
        console.error("Unable to load current page:", error);

        if (!cancelled) {
          setPageImages([]);
          setPageWarning(
            "The images on this page could not be loaded.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingPage(false);
        }
      }
    }

    void loadCurrentPage();

    return () => {
      cancelled = true;
    };
  }, [currentPageMetadata]);

  useEffect(() => {
    if (!selectedImage) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setSelectedImage(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedImage]);

  function changePage(page: number): void {
    const safePage = Math.max(
      1,
      Math.min(page, totalPages),
    );

    setCurrentPage(safePage);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function clearFilters(): void {
    setSearch("");
    setSelectedFolder(ALL_FOLDERS);
    setCurrentPage(1);
  }

  const resultStart =
    filteredImages.length === 0
      ? 0
      : (currentPage - 1) * PAGE_SIZE + 1;

  const resultEnd = Math.min(
    currentPage * PAGE_SIZE,
    filteredImages.length,
  );

  return (
    <div className="archive-app">
      <header className="archive-header">
        <div className="header-content">
          <p className="eyebrow">Digital Collection</p>

          <h1>Archive Image Viewer</h1>

          <p className="header-description">
            Search the archive, browse by folder, and select an
            image to view the full-resolution original.
          </p>
        </div>
      </header>

      <main className="archive-main">
        {loadingArchive && (
          <div className="status-panel">
            <div
              className="spinner"
              aria-hidden="true"
            />

            <strong>Loading archive</strong>

            <p>
              Reading image and folder information from S3.
            </p>
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

        {!loadingArchive && !archiveError && (
          <>
            <section
              className="archive-toolbar"
              aria-label="Archive controls"
            >
              <div className="toolbar-filters">
                <div className="folder-control">
                  <label htmlFor="folder-filter">
                    Folder
                  </label>

                  <select
                    id="folder-filter"
                    value={selectedFolder}
                    onChange={(event) => {
                      setSelectedFolder(event.target.value);
                    }}
                  >
                    {folders.map((folder) => (
                      <option
                        key={folder}
                        value={folder}
                      >
                        {folder} ({folderCounts.get(folder) ?? 0})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="search-control">
                  <label htmlFor="archive-search">
                    Search
                  </label>

                  <input
                    id="archive-search"
                    type="search"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                    }}
                    placeholder="Search images or folders..."
                    autoComplete="off"
                  />
                </div>

                <button
                  type="button"
                  className="clear-button"
                  onClick={clearFilters}
                  disabled={
                    search.length === 0 &&
                    selectedFolder === ALL_FOLDERS
                  }
                >
                  Clear
                </button>
              </div>

              <nav
                className="toolbar-pagination"
                aria-label="Archive pagination"
              >
                <button
                  type="button"
                  className="pagination-button"
                  onClick={() => {
                    changePage(currentPage - 1);
                  }}
                  disabled={
                    currentPage === 1 ||
                    loadingPage
                  }
                >
                  Previous
                </button>

                <div className="page-status">
                  <span>Page</span>
                  <strong>{currentPage}</strong>
                  <span>of</span>
                  <strong>{totalPages}</strong>
                </div>

                <button
                  type="button"
                  className="pagination-button"
                  onClick={() => {
                    changePage(currentPage + 1);
                  }}
                  disabled={
                    currentPage === totalPages ||
                    loadingPage
                  }
                >
                  Next
                </button>
              </nav>
            </section>

            <section className="result-summary">
              <div>
                <strong>{filteredImages.length}</strong>{" "}
                {filteredImages.length === 1 ? "image" : "images"}
              </div>

              {filteredImages.length > 0 && (
                <div>
                  Showing {resultStart} to {resultEnd}
                </div>
              )}
            </section>

            {filteredImages.length === 0 && (
              <div className="status-panel">
                <strong>No images found</strong>

                <p>
                  {images.length === 0
                    ? `No supported image files were found under "${ARCHIVE_PATH}".`
                    : "No images match the selected folder and search."}
                </p>

                {images.length > 0 && (
                  <button
                    type="button"
                    className="reset-button"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

            {filteredImages.length > 0 && pageWarning && (
              <div
                className="page-warning"
                role="status"
              >
                {pageWarning}
              </div>
            )}

            {filteredImages.length > 0 && loadingPage && (
              <div className="status-panel">
                <div
                  className="spinner"
                  aria-hidden="true"
                />

                <strong>
                  Loading page {currentPage}
                </strong>

                <p>
                  Loading up to {PAGE_SIZE} archive images.
                </p>
              </div>
            )}

            {filteredImages.length > 0 && !loadingPage && (
              <section
                className="image-grid"
                aria-label="Archive images"
              >
                {pageImages.map((image) => (
                  <button
                    key={image.path}
                    type="button"
                    className="image-card"
                    aria-label={`Open ${image.name}`}
                    onClick={() => {
                      setSelectedImage(image);
                    }}
                  >
                    <div className="thumbnail">
                      {canPreviewInBrowser(image.path) ? (
                        <img
                          src={image.url}
                          alt={image.name}
                          loading="lazy"
                          decoding="async"
                          onError={(event) => {
                            console.error(
                              "Browser could not display image:",
                              image.path,
                            );

                            event.currentTarget.classList.add(
                              "broken-image",
                            );
                          }}
                        />
                      ) : (
                        <div className="unsupported-image">
                          <strong>TIFF</strong>
                          <span>
                            Browser preview unavailable
                          </span>
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

                      <span
                        className="folder-name"
                        title={image.folder}
                      >
                        {image.folder}
                      </span>

                      <div className="image-details">
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

            {filteredImages.length > 0 && (
              <nav
                className="bottom-pagination"
                aria-label="Bottom archive pagination"
              >
                <button
                  type="button"
                  className="pagination-button"
                  onClick={() => {
                    changePage(currentPage - 1);
                  }}
                  disabled={
                    currentPage === 1 ||
                    loadingPage
                  }
                >
                  Previous
                </button>

                <div className="page-status">
                  <span>Page</span>
                  <strong>{currentPage}</strong>
                  <span>of</span>
                  <strong>{totalPages}</strong>
                </div>

                <button
                  type="button"
                  className="pagination-button"
                  onClick={() => {
                    changePage(currentPage + 1);
                  }}
                  disabled={
                    currentPage === totalPages ||
                    loadingPage
                  }
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </main>

      {selectedImage && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Viewing ${selectedImage.name}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedImage(null);
            }
          }}
        >
          <div className="lightbox-content">
            <header className="lightbox-header">
              <div className="lightbox-title">
                <span>{selectedImage.folder}</span>
                <strong>{selectedImage.name}</strong>
              </div>

              <button
                type="button"
                className="close-button"
                aria-label="Close image viewer"
                onClick={() => {
                  setSelectedImage(null);
                }}
              >
                ×
              </button>
            </header>

            <div className="lightbox-image">
              {canPreviewInBrowser(selectedImage.path) ? (
                <img
                  src={selectedImage.url}
                  alt={selectedImage.name}
                />
              ) : (
                <div className="tiff-message">
                  <strong>
                    Browser preview unavailable
                  </strong>

                  <p>
                    This TIFF file may not display directly in
                    the browser. Use Open original to access
                    the source file.
                  </p>
                </div>
              )}
            </div>

            <footer className="lightbox-footer">
              <div className="lightbox-metadata">
                <span>
                  Folder: {selectedImage.folder}
                </span>

                {selectedImage.lastModified && (
                  <span>
                    Modified:{" "}
                    {selectedImage.lastModified.toLocaleDateString()}
                  </span>
                )}

                {selectedImage.size !== undefined && (
                  <span>
                    Size: {formatBytes(selectedImage.size)}
                  </span>
                )}
              </div>

              <a
                className="open-original"
                href={selectedImage.url}
                target="_blank"
                rel="noreferrer"
              >
                Open original
              </a>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
