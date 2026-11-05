import { useEffect, useState } from "react";
import type { Schema } from "../amplify/data/resource";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { generateClient } from "aws-amplify/data";

const client = generateClient<Schema>();

function App() {
  const [todos, setTodos] =
    useState<Array<Schema["Todo"]["type"]>>([]);

  const { signOut } = useAuthenticator();

  useEffect(() => {
    const subscription =
      client.models.Todo.observeQuery().subscribe({
        next: (data) => {
          setTodos([...data.items]);
        },
      });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  function createTodo() {
    const content = window.prompt("Todo content");

    if (!content) {
      return;
    }

    client.models.Todo.create({
      content,
    });
  }

  return (
    <main>
      <h1>My todos</h1>

      <button type="button" onClick={createTodo}>
        + new
      </button>

      <button type="button" onClick={signOut}>
        Sign out
      </button>

      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            {todo.content}
          </li>
        ))}
      </ul>

      <div>
        🥳 App successfully hosted. Try creating a new todo.

        <br />

        <a
          href="https://docs.amplify.aws/react/start/quickstart/#make-frontend-updates"
          target="_blank"
          rel="noopener noreferrer"
        >
          Review next step of this tutorial.
        </a>
      </div>
    </main>
  );
}

export default App;
