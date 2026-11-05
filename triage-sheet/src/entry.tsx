import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { createApi, type Api } from "./api";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import css from "./index.css?inline";

let root: Root | null = null;
let styled = false;
let api: Api | null = null;

// The sandbox evaluates one CommonJS file and calls this on every host update, so the root, the
// stylesheet and the api are created once. A new `api` would reload the queue and drop edits.
export function render(_data: unknown, container: HTMLElement) {
  if (!styled) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    styled = true;
  }
  root ??= createRoot(container);
  api ??= createApi((operation, args) => window.langsmith.call(operation, args));
  root.render(createElement(ErrorBoundary, null, createElement(App, { api })));
}

// Some sandbox hosts call a bare default export.
const entry = { render };
export default entry;
