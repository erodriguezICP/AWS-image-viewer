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
        collection
