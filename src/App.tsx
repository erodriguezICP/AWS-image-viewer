import { useMemo, useState } from "react";
import { useAuthenticator } from "@aws-amplify/ui-react";

type ImageItem = {
  id: number;
  title: string;
  filename: string;
  url: string;
};

const images: ImageItem[] = [
  {
    id: 1,
    title: "Museum Exterior",
    filename: "museum-exterior.jpg",
    url: "https://images.unsplash.com/photo-1561214115-f2f134cc4912?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: 2,
    title: "Gallery Installation",
    filename: "gallery-installation.jpg",
    url: "https://images.unsplash.com/photo-1549490349-8643362247b5?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: 3,
    title: "Collection Image",
    filename: "collection-image.jpg",
    url: "https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?auto=format&fit=crop&w=1200&q=80",
  },
];

function App() {
  const { user, signOut } = useAuthenticator();

  const [search, setSearch] = useState("");
  const [selectedImage, setSelectedImage] =
    useState<ImageItem | null>(null);

  const filteredImages = useMemo(() => {
    const query = search.toLowerCase().trim();

    if (!query) {
      return images;
    }

    return images.filter((image) => {
      return (
        image.title.toLowerCase().includes(query) ||
        image.filename.toLowerCase().includes(query)
      );
    });
  }, [search]);

  return (
    <div style={styles.page}>
      {/* HEADER */}

      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Image Viewer</h1>

          <p style={styles.subtitle}>
            AWS Amplify + React + Vite
          </p>

          <p style={styles.user}>
            Signed in as{" "}
            {user?.signInDetails?.loginId ??
              user?.username ??
              "User"}
          </p>
        </div>

        <button
          type="button"
          onClick={signOut}
          style={styles.signOutButton}
        >
          Sign Out
        </button>
      </header>

      {/* MAIN CONTENT */}

      <main style={styles.main}>
        {/* SEARCH */}

        <section style={styles.searchSection}>
          <input
            type="search"
            placeholder="Search images..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            style={styles.searchInput}
          />

          <div style={styles.resultCount}>
            {filteredImages.length}{" "}
            {filteredImages.length === 1
              ? "image"
              : "images"}
          </div>
        </section>

        {/* IMAGE GRID */}

        {filteredImages.length > 0 ? (
          <section style={styles.grid}>
            {filteredImages.map((image) => (
              <article
                key={image.id}
                style={styles.card}
              >
                <button
                  type="button"
                  onClick={() =>
                    setSelectedImage(image)
                  }
                  style={styles.imageButton}
                >
                  <img
                    src={image.url}
                    alt={image.title}
                    style={styles.image}
                    loading="lazy"
                  />
                </button>

                <div style={styles.cardContent}>
                  <h2 style={styles.cardTitle}>
                    {image.title}
                  </h2>

                  <p style={styles.filename}>
                    {image.filename}
                  </p>

                  <button
                    type="button"
                    onClick={() =>
                      setSelectedImage(image)
                    }
                    style={styles.viewButton}
                  >
                    View Image
                  </button>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <div style={styles.empty}>
            <h2>No images found</h2>
            <p>
              Try searching with another filename
              or title.
            </p>
          </div>
        )}
      </main>

      {/* IMAGE PREVIEW */}

      {selectedImage && (
        <div
          style={styles.overlay}
          onClick={() =>
            setSelectedImage(null)
          }
        >
          <div
            style={styles.modal}
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div style={styles.modalHeader}>
              <div>
                <h2 style={styles.modalTitle}>
                  {selectedImage.title}
                </h2>

                <p style={styles.filename}>
                  {selectedImage.filename}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSelectedImage(null)
                }
                style={styles.closeButton}
              >
                Close
              </button>
            </div>

            <img
              src={selectedImage.url}
              alt={selectedImage.title}
              style={styles.largeImage}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#f4f6f8",
    color: "#17202a",
    fontFamily:
      "Arial, Helvetica, sans-serif",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "20px",
    padding: "24px 5%",
    backgroundColor: "#102a43",
    color: "#ffffff",
  },

  title: {
    margin: 0,
    fontSize: "32px",
  },

  subtitle: {
    margin: "5px 0",
    color: "#bcccdc",
  },

  user: {
    margin: "5px 0 0",
    fontSize: "14px",
  },

  signOutButton: {
    border: "none",
    borderRadius: "8px",
    padding: "10px 18px",
    backgroundColor: "#ffffff",
    color: "#102a43",
    cursor: "pointer",
    fontWeight: 600,
  },

  main: {
    width: "90%",
    maxWidth: "1200px",
    margin: "30px auto",
  },

  searchSection: {
    marginBottom: "25px",
  },

  searchInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: "14px",
    border: "1px solid #bcccdc",
    borderRadius: "8px",
    fontSize: "16px",
  },

  resultCount: {
    marginTop: "10px",
    color: "#627d98",
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(240px, 1fr))",
    gap: "20px",
  },

  card: {
    overflow: "hidden",
    borderRadius: "12px",
    backgroundColor: "#ffffff",
    boxShadow:
      "0 4px 12px rgba(0,0,0,0.08)",
  },

  imageButton: {
    display: "block",
    width: "100%",
    margin: 0,
    padding: 0,
    border: "none",
    background: "none",
    cursor: "pointer",
  },

  image: {
    display: "block",
    width: "100%",
    height: "220px",
    objectFit: "cover",
  },

  cardContent: {
    padding: "16px",
  },

  cardTitle: {
    margin: "0 0 8px",
    fontSize: "18px",
  },

  filename: {
    margin: "0 0 12px",
    color: "#627d98",
    wordBreak: "break-word",
  },

  viewButton: {
    border: "none",
    borderRadius: "7px",
    padding: "9px 15px",
    backgroundColor: "#0073bb",
    color: "#ffffff",
    cursor: "pointer",
  },

  empty: {
    padding: "60px",
    textAlign: "center",
    backgroundColor: "#ffffff",
    borderRadius: "10px",
  },

  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
    backgroundColor:
      "rgba(0,0,0,0.85)",
  },

  modal: {
    width: "100%",
    maxWidth: "1000px",
    maxHeight: "90vh",
    overflow: "auto",
    boxSizing: "border-box",
    padding: "20px",
    borderRadius: "12px",
    backgroundColor: "#ffffff",
  },

  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "20px",
    marginBottom: "15px",
  },

  modalTitle: {
    margin: "0 0 5px",
  },

  closeButton: {
    border: "none",
    borderRadius: "7px",
    padding: "9px 15px",
    backgroundColor: "#d64545",
    color: "#ffffff",
    cursor: "pointer",
  },

  largeImage: {
    display: "block",
    width: "100%",
    maxHeight: "70vh",
    objectFit: "contain",
    backgroundColor: "#000000",
  },
};

export default App;
