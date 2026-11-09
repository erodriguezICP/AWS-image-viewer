import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getUrl, list } from "aws-amplify/storage";
import "./App.css";

type ArchiveImage = {
  path: string;
  name: string;
  folder: string;
  relativeFolder: string;
  size?: number;
  lastModified?: Date;
};

type ArchiveImageWithUrl = ArchiveImage & {
  url: string;
};

type GroupedArchiveImages = {
  folder: string;
  images: ArchiveImageWithUrl[];
};

const ARCHIVE_PATH = "Key Manifest/";

/*
 * If the actual S3 prefix uses an underscore, use:
 *
 * const ARCHIVE_PATH = "Key_Manifest/";
 */

const S3_BUCKET = {
  bucketName: "manifest-inventory",
  region: "us-east-1",
};

const IMAGE_FILE =
  /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;

const BROWSER_PREVIEW_FILE =
  /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

const PAGE_SIZE = 24;
const URL_EXPIRATION_SECONDS = 3600;
const ALL_FOLDERS = "All folders";
const ROOT_FOLDER = "Uncategorized";

function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

function getRelativePath(path: string): string {
  if (path.startsWith(ARCHIVE_PATH)) {
    return path.slice(ARCHIVE_PATH.length);
  }

  return path;
}

function getFolderName(path: string): string {
  const relativePath = getRelativePath(path);
  const parts = relativePath.split("/").filter(Boolean);

  if (parts.length <= 1) {
    return ROOT_FOLDER;
  }

  /*
   * Uses the first folder below ARCHIVE_PATH as the category.
   *
   * Example:
   * Key Manifest/Events/2025/photo.jpg
   *
   * Category:
   * Events
   */
  return parts[0];
}

function getRelativeFolder(path: string): string {
  const relativePath = getRelativePath(path);
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
  return BROWSER_PREVIEW_FILE.test(path);
}

export default function App() {
  const [images, setImages] = useState<ArchiveImage[]>([]);
  const [displayImages, setDisplayImages] = useState<
    ArchiveImageWithUrl[]
  >([]);

  const [search, setSearch] = useState("");
  const [selectedFolder, setSelectedFolder] =
    useState(ALL_FOLDERS);
  const [currentPage, setCurrentPage] = useState(1);

  const [selectedImage, setSelectedImage] =
    useState<ArchiveImageWithUrl | null>(null);

  const [loadingArchive, setLoadingArchive] =
    useState(true);
  const [loadingPage, setLoadingPage] =
    useState(false);

  const [archiveError, setArchiveError] = useState("");
  const [pageWarning, setPageWarning] = useState("");

  /*
   * Signed URLs are cached for the current browser session.
   * This prevents repeat getUrl calls when users revisit a page.
   */
  const urlCache = useRef<Map<string, string>>(
    new Map(),
  );

  /*
   * Load image metadata from S3.
   *
   * This does not generate signed URLs for all images.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadArchiveMetadata() {
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

        const archiveImages: ArchiveImage[] =
          result.items
            .filter((item) =>
              IMAGE_FILE.test(item.path),
            )
            .map((item) => ({
              path: item.path,
              name: getFileName(item.path),
              folder: getFolderName(item.path),
              relativeFolder: getRelativeFolder(
                item.path,
              ),
              size: item.size,
              lastModified: item.lastModified,
            }))
            .sort((a, b) => {
              const folderComparison =
                a.relativeFolder.localeCompare(
                  b.relativeFolder,
                  undefined,
                  {
                    numeric: true,
                    sensitivity: "base",
                  },
                );

              if (folderComparison !== 0) {
                return folderComparison;
              }

              return a.name.localeCompare(
                b.name,
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
        console.error(
          "Unable to list archive images:",
          error,
        );

        if (!cancelled) {
          setArchiveError(
            `Unable to load images from "${ARCHIVE_PATH}". ` +
              "Verify the exact S3 prefix, bucket name, " +
              "AWS Region, and Amplify Storage permissions.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingArchive(false);
        }
      }
    }

    void loadArchiveMetadata();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Build the folder category list from the S3 object paths.
   */
  const folders = useMemo(() => {
    const uniqueFolders = new Set(
      images.map((image) => image.folder),
    );

    return [
      ALL_FOLDERS,
      ...Array.from(uniqueFolders).sort((a, b) =>
        a.localeCompare(b, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      ),
    ];
  }, [images]);

  /*
   * Count the number of images in each category.
   */
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();

    counts.set(ALL_FOLDERS, images.length);

    for (const image of images) {
      counts.set(
        image.folder,
        (counts.get(image.folder) || 0) + 1,
      );
    }

    return counts;
  }, [images]);

  /*
   * Search the entire archive metadata before pagination.
   *
   * This lets users find images that are not displayed
   * on the current page.
   */
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
        image.path,
        image.folder,
        image.relativeFolder,
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

  /*
   * Reset to page 1 whenever search or folder changes.
   */
  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedFolder]);

  /*
   * Keep the current page inside the valid range.
   */
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  /*
   * Select only the metadata for the current page.
   */
  const currentPageMetadata = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    return filteredImages.slice(start, end);
  }, [filteredImages, currentPage]);

  /*
   * Generate signed URLs only for images on the current page.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadCurrentPage() {
      if (currentPageMetadata.length === 0) {
        setDisplayImages([]);
        setPageWarning("");
        return;
      }

      try {
        setLoadingPage(true);
        setPageWarning("");

        const results = await Promise.allSettled(
          currentPageMetadata.map(
            async (
              image,
            ): Promise<ArchiveImageWithUrl> => {
              const cachedUrl = urlCache.current.get(
                image.path,
              );

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
                  expiresIn:
                    URL_EXPIRATION_SECONDS,
                },
              });

              const signedUrl =
                result.url.toString();

              urlCache.current.set(
                image.path,
                signedUrl,
              );

              return {
                ...image,
                url: signedUrl,
              };
            },
          ),
        );

        const successfulImages: ArchiveImageWithUrl[] =
          [];

        let failedCount = 0;

        for (const result of results) {
          if (result.status === "fulfilled") {
            successfulImages.push(result.value);
          } else {
            failedCount += 1;

            console.error(
              "Unable to generate image URL:",
              result.reason,
            );
          }
        }

        if (!cancelled) {
          setDisplayImages(successfulImages);

          if (failedCount > 0) {
            setPageWarning(
              `${failedCount} image${
                failedCount === 1 ? "" : "s"
              } on this page could not be loaded.`,
            );
          }
        }
      } catch (error) {
        console.error(
          "Unable to load the current page:",
          error,
        );

        if (!cancelled) {
          setDisplayImages([]);
          setPageWarning(
            "Unable to generate image URLs for this page.",
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

  /*
   * Group the current page into S3 folder sections.
   */
  const groupedImages = useMemo(() => {
    const groups = new Map<
      string,
      ArchiveImageWithUrl[]
    >();

    for (const image of displayImages) {
      const groupingFolder =
        image.relativeFolder || ROOT_FOLDER;

      const existingImages =
        groups.get(groupingFolder) || [];

      existingImages.push(image);

      groups.set(
        groupingFolder,
        existingImages,
      );
    }

    return Array.from(groups.entries())
      .sort(([folderA], [folderB]) =>
        folderA.localeCompare(
          folderB,
          undefined,
          {
            numeric: true,
            sensitivity: "base",
          },
        ),
      )
      .map(
        ([folder, groupedFolderImages]): GroupedArchiveImages => ({
          folder,
          images: groupedFolderImages,
        }),
      );
  }, [displayImages]);

  /*
   * Close the lightbox with the Escape key.
   */
  useEffect(() => {
    if (!selectedImage) {
      return;
    }

    function handleKeyDown(
      event: KeyboardEvent,
    ) {
      if (event.key === "Escape") {
        setSelectedImage(null);
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [selectedImage]);

  function goToPage(page: number) {
    const validPage = Math.min(
      totalPages,
      Math.max(1, page),
    );

    setCurrentPage(validPage);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function clearFilters() {
    setSearch("");
    setSelectedFolder(ALL_FOLDERS);
    setCurrentPage(1);
  }

  const firstVisibleResult =
    filteredImages.length === 0
      ? 0
      : (currentPage - 1) * PAGE_SIZE + 1;

  const lastVisibleResult = Math.min(
    currentPage * PAGE_SIZE,
    filteredImages.length,
  );

  return (
    <div className="archive-app">
      <header className="archive-header">
        <div className="header-content">
          <p className="eyebrow">
            Digital Collection
          </p>

          <h1>Archive Image Viewer</h1>

          <p className="header-description">
            Search the entire archive, browse by
            folder, and open an image to view the
            original.
          </p>
        </div>
      </header>

      <main className="archive-main">
        <section
          className="archive-controls"
          aria-label="Archive search and filters"
        >
          <div className="search-field">
            <label htmlFor="archive-search">
              Search all images
            </label>

            <input
              id="archive-search"
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search filename or folder..."
              autoComplete="off"
            />
          </div>

          <div className="folder-field">
            <label htmlFor="folder-filter">
              Folder category
            </label>

            <select
              id="folder-filter"
              value={selectedFolder}
              onChange={(event) =>
                setSelectedFolder(
                  event.target.value,
                )
              }
            >
              {folders.map((folder) => (
                <option
                  key={folder}
                  value={folder}
                >
                  {folder} (
                  {folderCounts.get(folder) || 0})
                </option>
              ))}
            </select>
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
            Clear filters
          </button>
        </section>

        <section className="archive-summary">
          <div>
            <strong>
              {filteredImages.length}
            </strong>{" "}
            result
            {filteredImages.length === 1
              ? ""
              : "s"}
          </div>

          <div>
            {filteredImages.length > 0 && (
              <>
                Showing {firstVisibleResult} to{" "}
                {lastVisibleResult} of{" "}
                {filteredImages.length}
              </>
            )}
          </div>
        </section>

        {loadingArchive && (
          <div className="status-panel">
            <div
              className="spinner"
              aria-hidden="true"
            />

            <strong>Loading archive</strong>

            <p>
              Reading image and folder metadata
              from S3.
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

        {!loadingArchive &&
          !archiveError &&
          filteredImages.length === 0 && (
            <div className="status-panel">
              <strong>No images found</strong>

              <p>
                {images.length === 0
                  ? `No supported image files were found under "${ARCHIVE_PATH}".`
                  : "No images match the current search and folder filters."}
              </p>

              {images.length > 0 && (
                <button
                  type="button"
                  className="status-clear-button"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

        {!loadingArchive &&
          !archiveError &&
          filteredImages.length > 0 && (
            <>
              <nav
                className="pagination pagination-top"
                aria-label="Top archive pagination"
              >
                <button
                  type="button"
                  className="pagination-button"
                  onClick={() =>
                    goToPage(currentPage - 1)
                  }
                  disabled={
                    currentPage === 1 ||
                    loadingPage
                  }
                >
                  Previous
                </button>

                <div className="pagination-status">
                  Page{" "}
                  <strong>{currentPage}</strong>
                  {" "}of{" "}
                  <strong>{totalPages}</strong>
                </div>

                <button
                  type="button"
                  className="pagination-button"
                  onClick={() =>
                    goToPage(currentPage + 1)
                  }
                  disabled={
                    currentPage === totalPages ||
                    loadingPage
                  }
                >
                  Next
                </button>
              </nav>

              {pageWarning && (
                <div
                  className="page-warning"
                  role="status"
                >
                  {pageWarning}
                </div>
              )}

              {loadingPage ? (
                <div className="status-panel">
                  <div
                    className="spinner"
                    aria-hidden="true"
                  />

                  <strong>
                    Loading page {currentPage}
                  </strong>

                  <p>
                    Generating URLs for up to{" "}
                    {PAGE_SIZE} images.
                  </p>
                </div>
              ) : (
                <div className="folder-groups">
                  {groupedImages.map((group) => (
                    <section
                      className="folder-group"
                      key={group.folder}
                    >
                      <header className="folder-heading">
                        <div className="folder-icon">
                          📁
                        </div>

                        <div>
                          <h2>{group.folder}</h2>

                          <p>
                            {group.images.length} image
                            {group.images.length === 1
                              ? ""
                              : "s"}{" "}
                            on this page
                          </p>
                        </div>
                      </header>

                      <div className="image-grid">
                        {group.images.map(
                          (image) => (
                            <button
                              key={image.path}
                              type="button"
                              className="image-card"
                              onClick={() =>
                                setSelectedImage(
                                  image,
                                )
                              }
                              aria-label={`Open ${image.name}`}
                            >
                              <div className="thumbnail-container">
                                {canPreviewInBrowser(
                                  image.path,
                                ) ? (
                                  <img
                                    src={image.url}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    onError={(
                                      event,
                                    ) => {
                                      event.currentTarget.classList.add(
                                        "image-load-error",
                                      );

                                      console.error(
                                        "Browser could not display:",
                                        image.path,
                                      );
                                    }}
                                  />
                                ) : (
                                  <div className="unsupported-preview">
                                    <strong>
                                      TIFF
                                    </strong>

                                    <span>
                                      Preview unavailable
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

                                <div className="image-metadata">
                                  <span>
                                    {image.lastModified
                                      ? image.lastModified.toLocaleDateString()
                                      : "Date unavailable"}
                                  </span>

                                  {image.size !==
                                    undefined && (
                                    <span>
                                      {formatBytes(
                                        image.size,
                                      )}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          ),
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              )}

              <nav
                className="pagination"
                aria-label="Bottom archive pagination"
              >
                <button
                  type="button"
                  className="pagination-button"
                  onClick={() =>
                    goToPage(currentPage - 1)
                  }
                  disabled={
                    currentPage === 1 ||
                    loadingPage
                  }
                >
                  Previous
                </button>

                <div className="pagination-status">
                  Page{" "}
                  <strong>{currentPage}</strong>
                  {" "}of{" "}
                  <strong>{totalPages}</strong>
                </div>

                <button
                  type="button"
                  className="pagination-button"
                  onClick={() =>
                    goToPage(currentPage + 1)
                  }
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

      {selectedImage && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Viewing ${selectedImage.name}`}
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setSelectedImage(null);
            }
          }}
        >
          <div className="lightbox-content">
            <header className="lightbox-header">
              <div className="lightbox-title">
                <span>
                  {selectedImage.relativeFolder}
                </span>

                <strong>
                  {selectedImage.name}
                </strong>
              </div>

              <button
                type="button"
                className="close-button"
                onClick={() =>
                  setSelectedImage(null)
                }
                aria-label="Close image viewer"
              >
                ×
              </button>
            </header>

            <div className="lightbox-image">
              {canPreviewInBrowser(
                selectedImage.path,
              ) ? (
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
                    This is a TIFF image. Open the
                    original file in a compatible
                    image application.
                  </p>
                </div>
              )}
            </div>

            <footer className="lightbox-footer">
              <div className="lightbox-details">
                <span>
                  Folder:{" "}
                  {selectedImage.relativeFolder}
                </span>

                {selectedImage.lastModified && (
                  <span>
                    Modified:{" "}
                    {selectedImage.lastModified.toLocaleDateString()}
                  </span>
                )}

                {selectedImage.size !==
                  undefined && (
                  <span>
                    Size:{" "}
                    {formatBytes(
                      selectedImage.size,
                    )}
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
