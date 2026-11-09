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

type ArchiveImageWithUrl = ArchiveImage & {
  url: string;
};

const ARCHIVE_PATH = "Key Manifest/";

const S3_BUCKET = {
  bucketName: "manifest-inventory",
  region: "us-east-1",
};

const IMAGE_FILE = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;
const BROWSER_IMAGE = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

const PAGE_SIZE = 24;
const URL_EXPIRATION_SECONDS = 3600;

const ALL_COLLECTIONS = "All collections";
const ALL_CATEGORIES = "All categories";
const UNCATEGORIZED = "Uncategorized";

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
  const [pageImages, setPageImages] = useState<ArchiveImageWithUrl[]>([]);

  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState(ALL_COLLECTIONS);
  const [category, setCategory] = useState(ALL_CATEGORIES);

  const [page, setPage] = useState(1);

  const [selected, setSelected] =
    useState<ArchiveImageWithUrl | null>(null);

  const [loadingArchive, setLoadingArchive] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);

  const [error, setError] = useState("");
  const [pageWarning, setPageWarning] = useState("");

  const urlCache = useRef<Map<string, string>>(new Map());

  /*
   * Load S3 metadata once.
   *
   * Do not generate signed URLs for every archive object here.
   */
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
      } catch (caughtError) {
        console.error("Archive loading failed:", caughtError);

        if (!cancelled) {
          setError(
            `Unable to load images under "${ARCHIVE_PATH}". Check the S3 prefix, bucket configuration, region, and Amplify Storage permissions.`,
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
   * Collection filter values.
   */
  const collections = useMemo(() => {
    const values = Array.from(
      new Set(images.map((image) => image.collection)),
    );

    values.sort((a, b) =>
      a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    return values;
  }, [images]);

  /*
   * Category values respond to the selected collection.
   */
  const categories = useMemo(() => {
    const source =
      collection === ALL_COLLECTIONS
        ? images
        : images.filter(
            (image) => image.collection === collection,
          );

    const values = Array.from(
      new Set(source.map((image) => image.category)),
    );

    values.sort((a, b) =>
      a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

    return values;
  }, [images, collection]);

  /*
   * Search and filtering happen before pagination.
   */
  const filteredImages = useMemo(() => {
    const query = search.trim().toLowerCase();

    return images.filter((image) => {
      if (
        collection !== ALL_COLLECTIONS &&
        image.collection !== collection
      ) {
        return false;
      }

      if (
        category !== ALL_CATEGORIES &&
        image.category !== category
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchable = [
        image.name,
        image.collection,
        image.category,
        image.folder,
        image.path,
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [images, search, collection, category]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredImages.length / PAGE_SIZE),
  );

  /*
   * Reset pagination after filter changes.
   */
  useEffect(() => {
    setPage(1);
  }, [search, collection, category]);

  /*
   * Reset category when collection changes.
   */
  useEffect(() => {
    setCategory(ALL_CATEGORIES);
  }, [collection]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageMetadata = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;

    return filteredImages.slice(
      start,
      start + PAGE_SIZE,
    );
  }, [filteredImages, page]);

  /*
   * Generate signed URLs only for the 24 records
   * on the visible page.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadPageImages(): Promise<void> {
      if (pageMetadata.length === 0) {
        setPageImages([]);
        setPageWarning("");
        setLoadingPage(false);
        return;
      }

      try {
        setLoadingPage(true);
        setPageWarning("");

        const results = await Promise.allSettled(
          pageMetadata.map(
            async (image): Promise<ArchiveImageWithUrl> => {
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
                  expiresIn: URL_EXPIRATION_SECONDS,
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

        const loaded: ArchiveImageWithUrl[] = [];
        let failures = 0;

        for (const result of results) {
          if (result.status === "fulfilled") {
            loaded.push(result.value);
          } else {
            failures += 1;
            console.error(result.reason);
          }
        }

        if (!cancelled) {
          setPageImages(loaded);

          if (failures > 0) {
            setPageWarning(
              `${failures} image${
                failures === 1 ? "" : "s"
              } could not be loaded.`,
            );
          }
        }
      } catch (caughtError) {
        console.error(caughtError);

        if (!cancelled) {
          setPageImages([]);
          
