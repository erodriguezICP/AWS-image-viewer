import { useEffect, useState } from "react";
import type { Schema } from "../amplify/data/resource";
import { generateClient } from "aws-amplify/data";

import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

const client = generateClient<Schema>();

function TodoPage() {
  const [todos, setTodos] =
    useState<Array<Schema["Todo"]["type"]>>([]);

  useEffect(() => {
    const subscription = client.models.Todo.observeQuery().subscribe({
      next: (data) => setTodos([...data.items]),
    });

    return () => subscription.unsubscribe();
  }, []);

  function createTodo() {
    const content = window.prompt("Todo content");

    if (!content) return;

    client.models.Todo.create({
      content,
    });
  }

  return (
    <Authenticator>
      {({ signOut, user }) => (
        <main>
          <header>
            <h1>My Application</h1>

            <p>
              Logged in as:{" "}
              <strong>{user?.signInDetails?.loginId}</strong>
            </p>

            <button onClick={signOut}>
              Sign Out
            </button>
          </header>

          <hr />

          <section>
            <h2>My Todos</h2>

            <button onClick={createTodo}>
              + New Todo
            </button>

            <ul>
              {todos.map((todo) => (
                <li key={todo.id}>
                  {todo.content}
                </li>
              ))}
            </ul>
          </section>
        </main>
      )}
    </Authenticator>
  );
}

export default TodoPage;
 
   
   
   ,
