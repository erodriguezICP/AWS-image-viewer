import { useMemo, useState } from "react";
import "./App.css";

import { useMemo, useState } from "react";
import { getUrl, list } from "aws-amplify/storage";
import "./App.css";

type ArchiveImage = {
  path: string;
  name: string;
  url: string;
  size?: number;
  lastModified?: Date;
};

const ARCHIVE_PATH = "Archive_Image_Viewer/";
const IMAGE_FILE = /\.(avif|bmp|gif|jpe?g|png|tiff?|webp)$/i;

function fileName(path: string) {
  return path.split("/").pop() || path;
}

function formatBytes(bytes?: number) {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

        const objects = result.items.filter((item) => IMAGE_FILE.test(item.path));

        const loaded = await Promise.all(
          objects.map(async (item): Promise<ArchiveImage> => {
            const result = await getUrl({
              path: item.path,
              options: { expiresIn: 3600 },
            });

            return {
              path: item.path,
              name: fileName(item.path),
              url: result.url.toString(),
              size: item.size,
              lastModified: item.lastModified,
            };
          }),
        );

        if (!cancelled) {
          loaded.sort((a, b) => a.name.localeCompare(b.name));
          setImages(loaded);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(
            "Unable to load archive images. Check Amplify Storage access and the S3 folder path.",
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
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  const filteredImages = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return images;
    return images.filter((image) =>
      `${image.name} ${image.path}`.toLowerCase().includes(term),
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
          <span>{filteredImages.length} images</span>
        </div>

        {loading && <p className="status">Loading archive...</p>}
        {!loading && error && <p className="status error">{error}</p>}
        {!loading && !error && filteredImages.length === 0 && (
          <p className="status">No matching images found.</p>
        )}

        {!loading && !error && (
          <div className="image-grid">
            {filteredImages.map((image) => (
              <button
                key={image.path}
                className="image-card"
                type="button"
                onClick={() => setSelected(image)}
              >
                <img src={image.url} alt={image.name} loading="lazy" />
                <div className="image-info">
                  <strong>{image.name}</strong>
                  <span>
                    {image.lastModified?.toLocaleDateString() || ""}
                    {image.size !== undefined ? ` • ${formatBytes(image.size)}` : ""}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {selected && (
        <div className="lightbox" onClick={() => setSelected(null)}>
          <div className="lightbox-content" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="close-button"
              onClick={() => setSelected(null)}
              aria-label="Close viewer"
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
export default App;
