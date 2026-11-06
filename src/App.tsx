import { useState } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import "./App.css";

type ArchiveImage = {
  id: number;
  title: string;
  description: string;
  category: string;
  date: string;
  src: string;
  alt: string;
};

const archiveImages: ArchiveImage[] = [
  {
    id: 1,
    title: "Archive Photograph 001",
    description: "Historic archive photograph.",
    category: "Photography",
    date: "1940",
    src: "/images/archive-001.jpg",
    alt: "Archive photograph 001",
  },
  {
    id: 2,
    title: "Archive Photograph 002",
    description: "Historic city photograph.",
    category: "City",
    date: "1952",
    src: "/images/archive-002.jpg",
    alt: "Archive photograph 002",
  },
  {
    id: 3,
    title: "Archive Photograph 003",
    description: "Portrait from the photographic archive.",
    category: "Portrait",
    date: "1965",
    src: "/images/archive-003.jpg",
    alt: "Archive photograph 003",
  },
  {
    id: 4,
    title: "Archive Photograph 004",
    description: "Documentary image from the collection.",
    category: "Documentary",
    date: "1971",
    src: "/images/archive-004.jpg",
    alt: "Archive photograph 004",
  },
];

function App() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [selectedImage, setSelectedImage] =
    useState<ArchiveImage | null>(null);

  const categories = useMemo(() => {
    return ["All", ...new Set(archiveImages.map((image) => image.category))];
  }, []);

  const filteredImages = useMemo(() => {
    const searchTerm = search.toLowerCase().trim();

    return archiveImages.filter((image) => {
      const matchesCategory =
        category === "All" || image.category === category;

      const searchableText = [
        image.title,
        image.description,
        image.category,
        image.date,
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = searchableText.includes(searchTerm);

      return matchesCategory && matchesSearch;
    });
  }, [search, category]);

  function closeViewer() {
    setSelectedImage(null);
  }

  function showPreviousImage() {
    if (!selectedImage) return;

    const currentIndex = filteredImages.findIndex(
      (image) => image.id === selectedImage.id
    );

    if (currentIndex <= 0) {
      setSelectedImage(filteredImages[filteredImages.length - 1]);
    } else {
      setSelectedImage(filteredImages[currentIndex - 1]);
    }
  }

  function showNextImage() {
    if (!selectedImage) return;

    const currentIndex = filteredImages.findIndex(
      (image) => image.id === selectedImage.id
    );

    if (currentIndex === filteredImages.length - 1) {
      setSelectedImage(filteredImages[0]);
    } else {
      setSelectedImage(filteredImages[currentIndex + 1]);
    }
  }

  return (
    <div className="app">
      <header className="archive-header">
        <div className="header-content">
          <p className="eyebrow">DIGITAL COLLECTION</p>

          <h1>Archive Image Viewer</h1>

          <p className="header-description">
            Search and explore photographs from the digital archive.
          </p>
        </div>
      </header>

      <main className="archive-main">
        <section className="search-panel">
          <div className="search-container">
            <label htmlFor="archive-search">Search the archive</label>

            <input
              id="archive-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, description, year, or category..."
            />
          </div>

          <div className="filter-container">
            <label htmlFor="category-filter">Category</label>

            <select
              id="category-filter"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="archive-results">
          <div className="results-header">
            <h2>Collection</h2>

            <p>
              {filteredImages.length}{" "}
              {filteredImages.length === 1 ? "image" : "images"}
            </p>
          </div>

          {filteredImages.length > 0 ? (
            <div className="image-grid">
              {filteredImages.map((image) => (
                <article
                  className="image-card"
                  key={image.id}
                  onClick={() => setSelectedImage(image)}
                >
                  <div className="thumbnail-container">
                    <img
                      src={image.src}
                      alt={image.alt}
                      loading="lazy"
                    />
                  </div>

                  <div className="image-info">
                    <div className="image-meta">
                      <span>{image.category}</span>
                      <span>{image.date}</span>
                    </div>

                    <h3>{image.title}</h3>

                    <p>{image.description}</p>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedImage(image);
                      }}
                    >
                      View image
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="no-results">
              <h3>No images found</h3>
              <p>Try another keyword or category.</p>

              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setCategory("All");
                }}
              >
                Clear search
              </button>
            </div>
          )}
        </section>
      </main>

      {selectedImage && (
        <div
          className="viewer-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={selectedImage.title}
          onClick={closeViewer}
        >
          <div
            className="viewer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="viewer-toolbar">
              <div>
                <strong>{selectedImage.title}</strong>
                <span>
                  {selectedImage.category} · {selectedImage.date}
                </span>
              </div>

              <button
                className="close-button"
                type="button"
                onClick={closeViewer}
                aria-label="Close image viewer"
              >
                ×
              </button>
            </div>

            <div className="viewer-image-area">
              {filteredImages.length > 1 && (
                <button
                  className="navigation-button previous"
                  type="button"
                  onClick={showPreviousImage}
                  aria-label="Previous image"
                >
                  ‹
                </button>
              )}

              <img
                src={selectedImage.src}
                alt={selectedImage.alt}
              />

              {filteredImages.length > 1 && (
                <button
                  className="navigation-button next"
                  type="button"
                  onClick={showNextImage}
                  aria-label="Next image"
                >
                  ›
                </button>
              )}
            </div>

            <div className="viewer-caption">
              <p>{selectedImage.description}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
