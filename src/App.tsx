import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

import ImageViewer from "./ImageViewer";

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <main>
          <header>
            <h1>Image Archive</h1>

            <p>
              Signed in as:{" "}
              <strong>
                {user?.signInDetails?.loginId ?? "User"}
              </strong>
            </p>

            <button type="button" onClick={signOut}>
              Sign Out
            </button>
          </header>,
