import { useAuthenticator } from "@aws-amplify/ui-react";

function App() {
  const { user, signOut } = useAuthenticator();

  const username =
    user?.signInDetails?.loginId ||
    user?.username ||
    "User";

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#f4f6f8",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <header
        style={{
          backgroundColor: "#102a43",
          color: "#ffffff",
          padding: "24px",
        }}
      >
        <h1 style={{ margin: "0 0 8px" }}>
          Amplify Image Viewer
        </h1>

        <p style={{ margin: 0 }}>
          Signed in as {username}
        </p>
      </header>

      <section
        style={{
          maxWidth: "1000px",
          margin: "40px auto",
          padding: "30px",
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        }}
      >
        <h2>Deployment successful</h2>

        <p>
          Your React application is running successfully
          with AWS Amplify authentication.
        </p>

        <p>
          The next step is connecting this application
          to your S3 image bucket.
        </p>

        <button
          type="button"
          onClick={signOut}
          style={{
            marginTop: "20px",
            padding: "12px 20px",
            border: "none",
            borderRadius: "8px",
            backgroundColor: "#0073bb",
            color: "#ffffff",
            cursor: "pointer",
            fontSize: "16px",
          }}
        >
          Sign Out
        </button>
      </section>
    </main>
  );
}

export default App;
