/**
 * The browser entry: the one place the React shell is mounted into the document.
 *
 * **The mount happens once, at module evaluation.** `createRoot` is called with the element
 * `index.html` declares as `#root`, and the root handle is deliberately not kept, exported or
 * reused: nothing in this workspace ever mounts a second tree, and a handle held out here would be
 * an invitation to try.
 *
 * **The `#root` element is a contract, so its absence is reported rather than worked around.** If
 * `index.html` does not declare the element, this module prints one explanatory error through
 * `console.error` and stops. It does not fall back to `document.body`, does not create an element
 * of its own and does not fail silently: the three of those would each turn a broken shell into a
 * page that renders the wrong thing, or into a blank page with an empty console, and the reader
 * would have nothing to follow. Mounting nothing is a visible failure here.
 *
 * **The router and the shell belong to `./app`.** `App` renders its own `BrowserRouter`, its
 * landmark structure and the demonstration disclosure, so this module wraps it in nothing but
 * `StrictMode` — which is here so that a double-invoked effect in a page is visible during
 * development. No route, provider, error boundary or layout of any kind is added at this level.
 *
 * **The stylesheets are linked, not imported.** `index.html` links `./src/styles/tokens.css` and
 * `./src/styles/app.css`, which keeps the type check free of a module declaration for CSS and
 * keeps the workspace free of an ambient `d.ts` file. Importing a stylesheet from this module
 * would need one of those two, so it is not done, and no other side effect is either: no request,
 * no environment read, no storage access and no analytics.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./app";

/** The id of the mount element that `index.html` declares, and the only id this module knows. */
const MOUNT_ELEMENT_ID = "root";

const rootElement = document.getElementById(MOUNT_ELEMENT_ID);

if (rootElement === null) {
  console.error(
    `ADEM did not start: the document has no element with id "${MOUNT_ELEMENT_ID}" for the ` +
      "application to mount into. Restore that element in index.html, or point this module at " +
      "the id the document actually declares.",
  );
} else {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
