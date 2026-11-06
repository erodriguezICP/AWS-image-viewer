import { useMemo, useState } from "react";
import "./App.css";

type ArchiveImage = {
  id: number;
  title: string;
  description: string;
  category: string;
  date: string;
  url: string;
};

const archiveImages: ArchiveImage[] = [
  {
    id: 1,
    title: "Archive Image 1",
    description: "Historical archive image",
    category: "Archive",
    date: "2026-01-01",
    url: "https://placehold.co/800x600?text=Archive+Image+1",
  },
  {
    id: 2,
    title: "Archive Image 2",
    description: "Historical archive image",
    category: "Archive",
    date: "2026-02-01",
    url: "https://placehold.co/800x600?text=Archive+Image+2",
  },
  {
    id: 3,
    title: "Archive Image 3",
    description: "Historical archive image",
    category: "Documents",
    date: "2026-03-01",
    url: "https://placehold.co/800x600?text=Archive+Image+3",
  },
];

function App() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedImage, setSelectedImage] =
    useState<ArchiveImage | null>(null);

  const categories = useMemo<string[]>(() => {
    return [
      "All",
      ...Array.from(
        new Set(archiveImages.map((image: ArchiveImage) => image.category))
      ),
    ];
  }, []);

  const filteredImages = useMemo<ArchiveImage[]>(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return archiveImages.filter((image: ArchiveImage) => {
      const matchesSearch =
        normalizedSearch === "" ||
        image.title.toLowerCase().includes(normalizedSearch) ||
        image.description.toLowerCase().includes(normalizedSearch) ||
        image.category.toLowerCase().includes(normalizedSearch) ||
        image.date.toLowerCase().includes(normalizedSearch);

      const matchesCategory =
        selectedCategory === "All" ||
        image.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [searchTerm, selectedCategory]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Archive Image Viewer</h1>
          <p>
            Search, browse, and view images from the archive.
          </p>
        </div>
      </header>

      <main className="app-main">
        <section className="search-section">
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search archive..."
            aria-label="Search archive"
          />

          <select
            value={selectedCategory}
            onChange={(event) =>
              setSelectedCategory(event.target.value)
            }
            aria-label="Filter by category"
          >
            {categories.map((item: string) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </section>

        <section className="results-header">
          <h2>Images</h2>

          <span>
            {filteredImages.length}{" "}
            {filteredImages.length === 1 ? "image" : "images"}
          </span>
        </section>

        {filteredImages.length > 0 ? (
          <section className="image-grid">
            {filteredImages.map((image: ArchiveImage) => (
              <article
                className="image-card"
                key={image.id}
                onClick={() => setSelectedImage(image)}
              >
                <img
                  src={image.url}
                  alt={image.title}
                  loading="lazy"
                />

                <div className="image-info">
                  <h3>{image.title}</h3>
                  <p>{image.description}</p>

                  <div className="image-meta">
                    <span>{image.category}</span>
                    <span>{image.date}</span>
                  </div>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <section className="empty-state">
            <h2>No images found</h2>
            <p>
              Try changing your search term or category.
            </p>
          </section>
        )}
      </main>

      {selectedImage && (
        <div
          className="image-modal"
          role="dialog"
          aria-modal="true"
          aria-label={selectedImage.title}
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="image-modal-content"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              type="button"
              onClick={() => setSelectedImage(null)}
              aria-label="Close image"
            >
              ×
            </button>

            <img
              src={selectedImage.url}
              alt={selectedImage.title}
            />

            <div className="modal-details">
              <h2>{selectedImage.title}</h2>
              <p>{selectedImage.description}</p>

              <p>
                <strong>Category:</strong>{" "}
                {selectedImage.category}
              </p>

              <p>
                <strong>Date:</strong> {selectedImage.date}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
