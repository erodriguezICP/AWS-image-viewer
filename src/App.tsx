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
const BROWSER_PREVIEW_FILE = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

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
  return BROWSER_PREVIEW_FILE.test(path);
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
            name: 
