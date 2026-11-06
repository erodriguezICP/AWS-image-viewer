import { useEffect, useMemo, useState } from "react";
import { getUrl, list } from "aws-amplify/storage";
import "./App.css";

type ArchiveImage = {
  path: string;
  name: string;
  url: string;
  size?: number;
  lastModified?: Date;
};

const ARCHIVE_PATH = "Key_Manifest/";
const IMAGE_FILE = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;

function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function App() {
  const [images, setImages] = useState<ArchiveImage[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ArchiveImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadImages() {
      try {
        setLoading(true);
        setError("");

        const result = await list({
          path: ARCHIVE_PATH,
          options: { listAll: true },
        });

        const imageObjects = result.items.filter((item) =>
          IMAGE_FILE.test(item.path),
        );

        const loadedImages = await Promise.all(
          imageObjects.map(async (item): Promise<ArchiveImage> => {
            const signedUrl = await getUrl({
              path: item.path,
              options: { expiresIn: 3600 },
            });

            return {
              path: item.path,
              name: getFileName(item.path),
              url: signedUrl.url.toString(),
              size: item.size,
              lastModified: item.lastModified,
            };
          }),
        );

        if (!cancelled) {
          loadedImages.sort((a, b) => a.name.localeCompare(b.name));
          setImages(loadedImages);
        }
      } catch (err) {
        console.error("Failed to load archive images:", err);
        if (!cancelled) {
          setError(
            "Unable to load archive images. Check your Amplify Storage permissions and S3 archive path.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadImages();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selected]);

  const filteredImages = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return images;

    return images.filter((image) =>
      `${image.name} ${image.path}`.toLowerCase().includes(query),
    );
  }, [images, search]);

  return (
    <div className="archive-app">
      <header className="archive-header">
        <p className="eyebrow">Digital Collection</p>
        <h1>Archive Image Viewer</h1>
        <p>Search the archive and select a thumbnail to view the full image.</p>
      </header>

      <main className="archive-main">
        <div className="search-row">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search archive images..."
            aria-label="Search archive images"
          />
          <span>
            {filteredImages.length} of {images.length} images
          </span>
        </div>

        {loading && <p className="status">Loading archive...</p>}

        {!loading && error && (
          <p className="status error" role="alert">
            {error}
          </p>
        )}

        {!loading && !error && filteredImages.length === 0 && (
          <p className="status">
            {images.length === 0
              ? "No archive images were found."
              : `No images match “${search}”.`}
          </p>
        )}

        {!loading && !error && filteredImages.length > 0 && (
          <section className="image-grid" aria-label="Archive images">
            {filteredImages.map((image) => (
              <button
                key={image.path}
                className="image-card"
                type="button"
                onClick={() => setSelected(image)}
                aria-label={`Open ${image.name}`}
              >
                <img src={image.url} alt={image.name} loading="lazy" />
                <div className="image-info">
                  <strong title={image.name}>{image.name}</strong>
                  <span>
                    {image.lastModified?.toLocaleDateString() || "Date unavailable"}
                    {image.size !== undefined ? ` • ${formatBytes(image.size)}` : ""}
                  </span>
                </div>
              </button>
            ))}
          </section>
        )}
      </main>

      {selected && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Viewing ${selected.name}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <div className="lightbox-content">
            <button
              type="button"
              className="close-button"
              onClick={() => setSelected(null)}
              aria-label="Close image viewer"
            >
              ×
            </button>

            <img src={selected.url} alt={selected.name} />

            <div className="lightbox-footer">
              <strong>{selected.name}</strong>
              <a href={selected.url} target="_blank" rel="noreferrer">
                Open original
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
