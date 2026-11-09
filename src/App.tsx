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

function getFolder(path: string): string {
  let relativePath = path;

  if (relativePath.startsWith(ARCHIVE_PATH)) {
    relativePath = relativePath.slice(
      ARCHIVE_PATH.length,
    );
  }

  const parts = relativePath
    .split("/")
    .filter(Boolean);

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

  return `${(
    bytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;
}

function canPreview(path: string): boolean {
  return BROWSER_PREVIEW_FILE.test(path);
}

export default function App() {
  const [images, setImages] = useState<
    ArchiveImage[]
  >([]);

  const [pageImages, setPageImages] = useState<
    ArchiveImageWithUrl[]
  >([]);

  const [search, setSearch] = useState("");

  const [selectedFolder, setSelectedFolder] =
    useState(ALL_FOLDERS);

  const [currentPage, setCurrentPage] =
    useState(1);

  const [selectedImage, setSelectedImage] =
    useState<ArchiveImageWithUrl | null>(
      null,
    );

  const [loadingArchive, setLoadingArchive] =
    useState(true);

  const [loadingPage, setLoadingPage] =
    useState(false);

  const [error, setError] = useState("");

  const [pageWarning, setPageWarning] =
    useState("");

  /*
   * Cache signed URLs so moving between pages
   * does not immediately generate them again.
   */
  const urlCache = useRef<
    Map<string, string>
  >(new Map());

  /*
   * Load only the S3 metadata initially.
   *
   * We do NOT generate hundreds of signed URLs
   * during initial application load.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadArchive() {
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

        const archiveImages: ArchiveImage[] =
          result.items
            .filter((item) =>
              IMAGE_FILE.test(item.path),
            )
            .map((item) => ({
              path: item.path,
              name: getFileName(item.path),
              folder: getFolder(item.path),
              size: item.size,
              lastModified:
                item.lastModified,
            }))
            .sort((a, b) => {
              const folderSort =
                a.folder.localeCompare(
                  b.folder,
                  undefined,
                  {
                    numeric: true,
                    sensitivity: "base",
                  },
                );

              if (folderSort !== 0) {
                return folderSort;
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
      } catch (err) {
        console.error(
          "Failed to load archive:",
          err,
        );

        if (!cancelled) {
          setError(
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

  /*
   * Build the folder dropdown dynamically
   * from the object paths returned by S3.
   */
  const folders = useMemo(() => {
    const uniqueFolders = Array.from(
      new Set(
        images.map(
          (image) => image.folder,
        ),
      ),
    );

    uniqueFolders.sort((a, b) =>
      a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    return [
      ALL_FOLDERS,
      ...uniqueFolders,
    ];
  }, [images]);

  /*
   * Store image counts for each folder.
   */
  const folderCounts = useMemo(() => {
    const counts = new Map<
      string,
      number
    >();

    counts.set(
      ALL_FOLDERS,
      images.length,
    );

    images.forEach((image) => {
      counts.set(
        image.folder,
        (counts.get(image.folder) || 0) +
          1,
      );
    });

    return counts;
  }, [images]);

  /*
   * IMPORTANT:
   *
   * Search and folder filtering occur BEFORE
   * pagination.
   *
   * That means a search can find an image even
   * when that image is on another page.
   */
  const filteredImages = useMemo(() => {
    const query =
      search.trim().toLowerCase();

    return images.filter((image) => {
      const folderMatches =
        selectedFolder === ALL_FOLDERS ||
        image.folder ===
          selectedFolder;

      if (!folderMatches) {
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

      return searchableText.includes(
        query,
      );
    });
  }, [
    images,
    search,
    selectedFolder,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(
      filteredImages.length /
        PAGE_SIZE,
    ),
  );

  /*
   * Return to page 1 when a search or
   * folder filter changes.
   */
  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedFolder]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [
    currentPage,
    totalPages,
  ]);

  /*
   * Select only the 24 objects needed
   * for the current page.
   */
  const currentPageMetadata =
    useMemo(() => {
      const start =
        (currentPage - 1) *
        PAGE_SIZE;

      const end =
        start + PAGE_SIZE;

      return filteredImages.slice(
        start,
        end,
      );
    }, [
      filteredImages,
      currentPage,
    ]);

  /*
   * Generate signed URLs ONLY for the
   * current page.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      if (
        currentPageMetadata.length ===
        0
      ) {
        setPageImages([]);
        setPageWarning("");
        return;
      }

      try {
        setLoadingPage(true);
        setPageWarning("");

        const results =
          await Promise.allSettled(
            currentPageMetadata.map(
              async (
                image,
              ): Promise<ArchiveImageWithUrl> => {
                const cachedUrl =
                  urlCache.current.get(
                    image.path,
                  );

                if (cachedUrl) {
                  return {
                    ...image,
                    url: cachedUrl,
                  };
                }

                const urlResult =
                  await getUrl({
                    path: image.path,
                    options: {
                      bucket: S3_BUCKET,
                      expiresIn:
                        URL_EXPIRATION_SECONDS,
                    },
                  });

                const url =
                  urlResult.url.toString();

                urlCache.current.set(
                  image.path,
                  url,
                );

                return {
                  ...image,
                  url,
                };
              },
            ),
          );

        const successful: ArchiveImageWithUrl[] =
          [];

        let failures = 0;

        results.forEach((result) => {
          if (
            result.status ===
            "fulfilled"
          ) {
            successful.push(
              result.value,
            );
          } else {
            failures += 1;

            console.error(
              "Image URL failed:",
              result.reason,
            );
          }
        });

        if (!cancelled) {
          setPageImages(successful);

          if (failures > 0) {
            setPageWarning(
              `${failures} image${
                failures === 1 ? "" : "s"
              } could not be loaded on this page.`,
            );
          }
        }
      } catch (err) {
        console.error(
          "Unable to load page:",
          err,
        );

        if (!cancelled) {
          setPageImages([]);
          setPageWarning(
            "Unable to load this page.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingPage(false);
        }
      }
    }

    void loadPage();

    return () => {
      cancelled = true;
    };
  }, [currentPageMetadata]);

  /*
   * Escape closes the image viewer.
   */
  useEffect(() => {
    if (!selectedImage) {
      return;
    }

    function handleEscape(
      event: KeyboardEvent,
    ) {
      if (
        event.key === "Escape"
      ) {
        setSelectedImage(null);
      }
    }

    window.addEventListener(
      "keydown",
      handleEscape,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleEscape,
      );
    };
  }, [selectedImage]);

  function goToPage(page: number) {
    const safePage = Math.min(
      totalPages,
      Math.max(1, page),
    );

    setCurrentPage(safePage);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function clearFilters() {
    setSearch("");
    setSelectedFolder(
      ALL_FOLDERS,
    );
    setCurrentPage(1);
  }

  const resultStart =
    filteredImages.length === 0
      ? 0
      : (currentPage - 1) *
          PAGE_SIZE +
        1;

  const resultEnd = Math.min(
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

          <h1>
            Archive Image Viewer
          </h1>

          <p className="header-description">
            Search, browse by folder,
            and view the digital image
            archive.
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

            <strong>
              Loading archive
            </strong>

            <p>
              Reading image metadata
              from S3...
            </p>
          </div>
        )}

        {!loadingArchive &&
          error && (
            <div
              className="status-panel error-panel"
              role="alert"
            >
              <strong>
                Archive unavailable
              </strong>

              <p>{error}</p>
            </div>
          )}

        {!loadingArchive &&
          !error && (
            <>
              {/*
                MAIN TOOLBAR

                LEFT:
                Folder + search

                RIGHT:
                Pagination
              */}
              <section className="archive-toolbar">
                <div className="toolbar-filters">
                  <div className="folder-control">
                    <label htmlFor="folder-filter">
                      Folder
                    </label>

                    <select
                      id="folder-filter"
                      value={
                        selectedFolder
                      }
                      onChange={(
                        event,
                      ) =>
                        setSelectedFolder(
                          event.target
                            .value,
                        )
                      }
                    >
                      {folders.map(
                        (folder) => (
                          <option
                            key={
                              folder
                            }
                            value={
                              folder
                            }
                          >
                            {folder} (
                            {folderCounts.get(
                              folder,
                            ) || 0}
                            )
                          </option>
                        ),
                      )}
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
                      onChange={(
                        event,
                      ) =>
                        setSearch(
                          event.target
                            .value,
                        )
                      }
                      placeholder="Search images..."
                      autoComplete="off"
                    />
                  </div>

                  <button
                    type="button"
                    className="clear-button"
                    onClick={
                      clearFilters
                    }
                    disabled={
                      search.length ===
                        0 &&
                      selectedFolder ===
                        ALL_FOLDERS
                    }
                  >
                    Clear
                  </button>
                </div>

                <div className="toolbar-pagination">
                  <button
                    type="button"
                    className="pagination-button"
                    onClick={() =>
                      goToPage(
                        currentPage - 1,
                      )
                    }
                    disabled={
                      currentPage === 1 ||
                      loadingPage
                    }
                  >
                    Previous
                  </button>

                  <div className="page-status">
                    <span>Page</span>

                    <strong>
                      {currentPage}
                    </strong>

                    <span>of</span>

                    <strong>
                      {totalPages}
                    </strong>
                  </div>

                  <button
                    type="button"
                    className="pagination-button"
                    onClick={() =>
                      goToPage(
                        currentPage + 1,
                      )
                    }
                    disabled={
                      currentPage ===
                        totalPages ||
                      loadingPage
                    }
                  >
                    Next
                  </button>
                </div>
              </section>

              <section className="result-summary">
                <div>
                  <strong>
                    {
                      filteredImages.length
                    }
                  </strong>{" "}
                  image
                  {filteredImages.length ===
                  1
                    ? ""
                    : "s"}
                </div>

                {filteredImages.length >
                  0 && (
                  <div>
                    Showing{" "}
                    {resultStart} -{" "}
                    {resultEnd}
                  </div>
                )}
              </section>

              {filteredImages.length ===
                0 && (
                <div className="status-panel">
                  <strong>
                    No images found
                  </strong>

                  <p>
                    No images match
                    your current folder
                    and search filters.
              
