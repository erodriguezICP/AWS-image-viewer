import {
  Authenticator,
  ThemeProvider,
  useAuthenticator,
} from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import ArchiveViewer from "./ArchiveViewer";
import "./App.css";

function SignedInArchive() {
  const { user, signOut } = useAuthenticator((context) => [
    context.user,
    context.signOut,
  ]);

  return (
    <div className="authenticated-app">
      <header className="account-bar">
        <div className="account-copy">
          <strong>ICP Digital Archives</strong>
          <span>
            {user?.signInDetails?.loginId ?? user?.username ?? "Signed in"}
          </span>
        </div>

        <button
          className="sign-out-button"
          type="button"
          onClick={signOut}
        >
          Sign out
        </button>
      </header>

      <ArchiveViewer />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Authenticator
        loginMechanisms={["email"]}
        signUpAttributes={["email"]}
        formFields={{
          signIn: {
            username: {
              label: "Email address",
              placeholder: "you@example.org",
            },
          },
          signUp: {
            email: {
              label: "Email address",
              placeholder: "you@example.org",
              order: 1,
            },
            password: {
              label: "Create password",
              placeholder: "Enter a secure password",
              order: 2,
            },
            confirm_password: {
              label: "Confirm password",
              placeholder: "Re-enter your password",
              order: 3,
            },
          },
        }}
        components={{
          Header() {
            return (
              <div className="auth-brand">
                <div className="auth-mark">ICP</div>
                <div>
                  <h1>Digital Archives</h1>
                  <p>Create an account or sign in to view the archive.</p>
                </div>
              </div>
            );
          },
        }}
      >
        <SignedInArchive />
      </Authenticator>
    </ThemeProvider>
  );
}
