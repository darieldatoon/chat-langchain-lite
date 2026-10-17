import { Banner } from "@langchain/macaw-components/Banner";
import { useState } from "react";

import { clearPat, loadPat, savePat } from "../auth/pat";
import { SignIn } from "../auth/SignIn";
import { ChatShell } from "../chat/ChatShell";
import { findEnvironment, parseConfig } from "../config";
import { useHashRoute } from "./useHashRoute";

const configResult = parseConfig(import.meta.env);

export function App() {
  const [route, navigate] = useHashRoute();
  const [pat, setPat] = useState(() => loadPat(sessionStorage));

  if (!configResult.ok) {
    return (
      <div className="mx-auto max-w-xl p-space-6">
        <Banner intent="error" title="This build is missing configuration">
          <ul className="list-disc pl-space-5">
            {configResult.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Banner>
      </div>
    );
  }

  const config = configResult.config;
  const environment = findEnvironment(config, route.environment);

  if (!pat) {
    return (
      <SignIn
        environment={environment}
        workspaceId={config.workspaceId}
        onSignIn={(key) => {
          savePat(sessionStorage, key);
          setPat(key.trim());
        }}
      />
    );
  }

  return (
    <ChatShell
      config={config}
      environment={environment}
      threadId={route.threadId}
      pat={pat}
      onNavigate={navigate}
      onSignOut={() => {
        clearPat(sessionStorage);
        setPat(null);
      }}
    />
  );
}
