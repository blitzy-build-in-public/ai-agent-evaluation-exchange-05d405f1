import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The web workspace's build and dev-server configuration: the four decisions the public UI's
 * single build depends on.
 *
 * The build writes `apps/web/dist`, which is the directory `@fastify/static` serves, so `npm start`
 * serves the UI and the API from one process and the Playwright web server finds the built app where
 * it expects it. `emptyOutDir` keeps repeated builds from accumulating stale hashed assets in that
 * directory.
 *
 * Development needs no second origin: the dev server proxies `/api` to the API on its documented
 * default port, so `api-client.ts` keeps calling the relative `/api/v1` path in every environment
 * and there is no CORS configuration and no origin to configure.
 *
 * No environment input is read: not the ambient environment, not an environment file, not a
 * build-time replaced value, because the product runs with no environment variable and no secret
 * and an injected origin would be a second answer to a question the relative path already answers.
 * The stylesheets are linked from `index.html` rather than imported, so no CSS handling is
 * configured here and `tsc --build` stays free of a stylesheet module declaration.
 */
export default defineConfig({
  plugins: [react()],

  // Served by the API at the server root, never from a sub-path.
  base: "/",

  build: {
    // Relative to this workspace, producing `apps/web/dist/index.html` — the path the API's static
    // handler serves and the path the browser suites load.
    outDir: "dist",
    emptyOutDir: true,
    // The compiler's target, so the bundle and the type-checker agree on one language level.
    target: "es2022",
  },

  server: {
    proxy: {
      // Loopback only, at the API's documented default port: the browser reaches the API through
      // the dev server's own origin, so no CORS configuration exists anywhere in the product.
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
