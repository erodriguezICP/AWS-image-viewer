import { useEffect, useMemo, useState } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import "./App.css";

type ImageItem = {
  key: string;
  title: string;
  url: string;
  size: string;
};

const sampleImages: ImageItem[] = [
  {
    key: "archive/photograph-001.jpg",
    title: "Museum facade",
    url: "https://images.unsplash.com/photo-1561214115-f2f134cc4912?auto=format&fit=crop&w=1200&q=80",
    size: "2.4 MB",
  },
  {
    key: "archive/photograph-002.jpg",
    title: "Gallery installation",
    url: "https://images.unsplash.com/photo-1549490349-8643362247b5?auto=format&fit=crop&w=1200&q=80",
    size: "1.8 MB",
  },
  {
    key: "archive/photograph-003.jpg",
    title: "Sculpture study",
    url: "https://images.unsplash.com/photo-1547891654-e66ed7ebb968?auto=format&fit=crop&w=1200&q=80",
    size: "3.1 MB",
  },
  {
    key: "archive/photograph-004.jpg",
    title: "Collection detail",
    url: "https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?auto=format&fit=crop&w=1200&q=80",
    size: "2.0 MB",
  },
  {
    key: "archive/photograph-005.jpg",
    title: "Exhibition room",
    url: "https://images.unsplash.com/photo-1577083288073-40892c0860a4?auto=format&fit=crop&w=1200&q=80",
    size: "2.7 MB",
  },
  {
    key: "archive/photograph-006.jpg",
    title: "Archive object",
    url: "https://images.unsplash.com/photo-1564399579883-451a5d44ec08?auto=format&fit=crop&w=1200&q=80",
    size: "1.5 MB",
  },
];

export default function App() {
  const { signOut, user } = useAuthenticator();

  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<ImageItem | null>(null);

  const [bucketUrl, setBucketUrl] = useState(
    "https://manifest-inventory.s3.amazonaws.com"
  );

  const [showConfig, setShowConfig] = useState(false);

  const images = useMemo(() => {
    return sampleImages.filter((item) =>
      `${item.title} ${item.key}`
        .toLowerCase()
        .includes(query.toLowerCase())
    );
  }, [query]);

  const selectedIndex = selected
    ? images.findIndex((item) => item.key === selected.key)
    : -1;

  const move = (direction: number) => {
    if (images.length === 0) {
      return;
    }

    const currentIndex =
      selectedIndex >= 0 ? selectedIndex : 0;

    const nextIndex =
      (currentIndex + direction + images.length) %
      images.length;

    setSelected(images[nextIndex]);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!selected) {
        return;
      }

      if (event.key === "Escape") {
        setSelected(null);
      }

      if (event.key === "ArrowLeft") {
        move(-1);
      }

      if (event.key === "ArrowRight") {
        move(1);
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [selected, selectedIndex, images]);

  return (
    <div className="app-shell">

      {/* HEADER */}

      <header className="topbar">
        <div>
          <h1>Archive Image Viewer</h1>

          <p>
            Vite + React + Amplify Hosting + Amazon S3
          </p>
        </div>

        <div className="user-actions">
          <span>
            {user?.signInDetails?.loginId ?? "Signed in"}
          </span>

          <button
            type="button"
            onClick={() =>
              setShowConfig((value) => !value)
            }
          >
            Configure
          </button>

          <button
            type="button"
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="viewer">

        {/* S3 CONFIGURATION */}

        {showConfig && (
          <section className="config-panel">

            <h2>S3 connection</h2>

            <p>
              This currently displays the configured S3
              location. The image collection below is still
              using sample images.
            </p>

            <label htmlFor="bucketUrl">
              S3 or CloudFront base URL
            </label>

            <input
              id="bucketUrl"
              type="text"
              value={bucketUrl}
              onChange={(event) =>
                setBucketUrl(event.target.value)
              }
            />

          </section>
        )}

        {/* SEARCH */}

        <section className="toolbar">

          <input
            type="search"
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="Search filename or title"
            aria-label="Search images"
          />

          <button
            type="button"
            onClick={() => setView("grid")}
          >
            Grid
          </button>

          <button
            type="button"
            onClick={() => setView("list")}
          >
            List
          </button>

        </section>

        {/* COLLECTION HEADER */}

        <section className="collection-heading">

          <div>
            <h2>Collection</h2>

            <p>
              {images.length}{" "}
              {images.length === 1 ? "image" : "images"}
            </p>
          </div>

          <small>{bucketUrl}</small>

        </section>

        {/* NO RESULTS */}

        {images.length === 0 && (
          <div className="empty-state">
            No images match "{query}".
          </div>
        )}

        {/* GRID VIEW */}

        {images.length > 0 && view === "grid" && (

          <div className="image-grid">

            {images.map((image) => (

              <button
                type="button"
                className="image-card"
                key={image.key}
                onClick={() =>
                  setSelected(image)
                }
              >

                <img
                  src={image.url}
                  alt={image.title}
                  loading="lazy"
                />

                <div>

                  <strong>
                    {image.title}
                  </strong>

                  <span>
                    {image.key}
                  </span>

                  <small>
                    {image.size}
                  </small>

                </div>

              </button>

            ))}

          </div>

        )}

        {/* LIST VIEW */}

        {images.length > 0 && view === "list" && (

          <div className="image-list">

            {images.map((image) => (

              <button
                type="button"
                className="image-row"
                key={image.key}
                onClick={() =>
                  setSelected(image)
                }
              >

                <img
                  src={image.url}
                  alt={image.title}
                  loading="lazy"
                />

                <div>

                  <strong>
                    {image.title}
                  </strong>

                  <span>
                    {image.key}
                  </span>

                </div>

                <small>
                  {image.size}
                </small>

              </button>

            ))}

          </div>

        )}

      </main>

      {/* IMAGE LIGHTBOX */}

      {selected && (

        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Viewing ${selected.title}`}
          onClick={() =>
            setSelected(null)
          }
        >

          <button
            className="lightbox-close"
            type="button"
            onClick={() =>
              setSelected(null)
            }
          >
            Close
          </button>

          <button
            className="lightbox-previous"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              move(-1);
            }}
          >
            Previous
          </button>

          <div
            className="lightbox-content"
            onClick={(event) =>
              event.stopPropagation()
            }
          >

            <img
              src={selected.url}
              alt={selected.title}
            />

            <h2>
              {selected.title}
            </h2>

            <p>
              {selected.key}
            </p>

            <a
              href={selected.url}
              target="_blank"
              rel="noreferrer"
            >
              Open original
            </a>

          </div>

          <button
            className="lightbox-next"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              move(1);
            }}
          >
            Next
          </button>

        </div>

      )}

    </div>
  );
}
