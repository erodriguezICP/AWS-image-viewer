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
const URL_EXPIRES = 3600;

const ALL_COLLECTIONS = "All collections";
const ALL_CATEGORIES = "All categories";
const UNCATEGORIZED = "Uncategorized";

const IMAGE_FILE = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;
const BROWSER_IMAGE = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

function getPathParts(path: string): string[] {
  const relativePath = path.startsWith(ARCHIVE_PATH)
    ? path.slice(ARCHIVE_PATH.length)
    : path;

  return relativePath.split("/").filter(Boolean);
}

function getCollection(path: string): string {
  const parts = getPathParts(path);

  if (parts.length <= 1) {
    return UNCATEGORIZED;
  }

  return parts[0];
}

function getCategory(path: string): string {
  const parts = getPathParts(path);

  if (parts.length <= 2) {
    return UNCATEGORIZED;
  }

  return parts[1];
}

function getFolder(path: string): string {
  const parts = getPathParts(path);

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

  if (bytes < 1024 * 102
