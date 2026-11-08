# ADEM - the single image that serves both halves of the product: the Fastify API under /api/v1 and
# the built React UI, which the API itself serves from apps/web/dist, on one port, from one process,
# against one SQLite file. `docker compose up` reaches exactly this image, and it needs no
# environment variable and no secret: the two inputs the process reads, ADEM_PORT and ADEM_DB_PATH,
# both have working defaults (apps/api/src/config.ts).
#
# Debian slim, not Alpine, because of one dependency. better-sqlite3 9.6.0 publishes a Node 20 glibc
# x64 prebuilt binary (node-v115-linux-x64), so the native module is fetched rather than compiled and
# no build tooling (python3, make, g++) is installed here or required at any point. That prebuild does
# not apply to an Alpine base, where the install would have to compile from source.
#
# Three properties of the runtime decide the shape below.
#
# 1. The development dependencies are needed at run time. `npm start` is `tsx apps/api/src/index.ts`,
#    the build is `tsc --build`, and every workspace package exports TypeScript source
#    (`"./src/index.ts"`) and is consumed as source. The install is therefore a full `npm ci` from the
#    committed lockfile: never `npm ci --omit=dev`, never `NODE_ENV=production` ahead of it, and no
#    stage that leaves the development dependencies behind. NODE_ENV is deliberately not set at all -
#    the product reads it nowhere, and leaving it unset keeps a container run identical to the
#    documented `npm start` run.
# 2. The schema is created by the server, not by this file. apps/api/src/db/migrate.ts applies
#    packages/shared/migrations/*.sql in filename order from a directory it resolves from its own URL,
#    so no database is baked in: a fresh volume migrates on first start and is a no-op on the second.
# 3. This image starts the server and nothing else. It does not seed, because the seed entry writes
#    rows with fixed identifiers and a second run against an already seeded volume fails. Loading the
#    demo data is the documented one-time step, `docker compose exec app npm run seed`.
#
# The product's one network step in its lifetime is the one-time Playwright browser download for the
# browser suites. It belongs to a contributor's machine and to CI; this image installs no browser.

FROM node:20-bookworm-slim

LABEL org.opencontainers.image.title="ADEM" \
      org.opencontainers.image.description="Agent Development Exchange and Marketplace: the local web UI and JSON API in one image." \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# The manifests and the lockfile first, so that the install layer survives an edit to any source file.
# Every workspace manifest has to be present before `npm ci` runs: npm builds the workspace links from
# the declaration in the root manifest, and a workspace whose directory does not exist yet is a missing
# link rather than something to install.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/sgi-core/package.json ./packages/sgi-core/
COPY packages/sgi-fixtures/package.json ./packages/sgi-fixtures/
COPY packages/shield/package.json ./packages/shield/
COPY packages/commerce-sim/package.json ./packages/commerce-sim/
COPY examples/extension-fixture-pack/package.json ./examples/extension-fixture-pack/

# The full dependency set, from the committed lockfile alone, so the image holds the set the repository
# pins and nothing resolved afresh. No `--omit=dev` and no `npm rebuild`: the prebuilt better-sqlite3
# binary is what the install fetches. The audit and funding notices are off because they add a network
# call to a build that has no use for either.
RUN npm ci --no-audit --no-fund

# The source, after the install layer. .dockerignore keeps node_modules, every dist/, the .adem/
# database directory and the checkout's test and report artefacts out of the build context, so this
# copy can neither shadow the install above nor carry a host build into the image.
COPY . .

# Settle the copied tree's permissions rather than inherit them. A source file written by an editor or
# a tool running with a restrictive umask arrives here as 0600 and root-owned, and this image runs as
# `node`, which then cannot open it - the server would fail at start-up on a file it is expected to
# read. Directories stay traversable and every file becomes readable; write access is not granted
# anywhere but the database directory below, so the application code stays immutable to its runtime
# user. `a+rX` is a no-op on everything already readable, which is all of node_modules.
RUN chmod -R a+rX /app

# Type-check every workspace and build the web application into apps/web/dist, which is the directory
# the composition root serves from whenever it is present.
RUN npm run build

# The database directory, and the only path the runtime user has to be able to write: the SQLite file
# and its write-ahead log live here, everything else under /app is read-only to it. A broader
# `chown -R node:node /app` would duplicate the whole install into this layer for no runtime need.
# Docker copies this directory's ownership into a named volume mounted here, so a fresh volume is
# writable by the non-root user and the default database path needs no privileged start.
RUN mkdir -p /app/.adem && chown node:node /app/.adem

# The database path the API computes for itself (apps/api/src/config.ts resolves `.adem/adem.sqlite`
# against the repository root, which is /app here), stated so that `docker compose up` and a bare
# `docker run` open the same file. ADEM_PORT is deliberately not set: 3000 is the resolved default and
# the port published below, and a deployment that publishes another one sets the variable itself.
ENV ADEM_DB_PATH=/app/.adem/adem.sqlite

EXPOSE 3000

# Readiness through Node's own global fetch, so no curl or wget has to be installed. The API's listing
# route is probed rather than the UI entry: a 200 from it proves the process is listening, the schema
# has been migrated and the store answers, and it holds whether or not the web build is present, which
# is the state apps/api/src/server.ts supports for a checkout whose web build has not run.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.ADEM_PORT || '3000') + '/api/v1/listings').then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]

USER node

CMD ["npm", "start"]
