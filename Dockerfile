# One image, two jobs: the web service (the default command) and the
# release job that migrates and seeds before each deploy (cloudbuild.yaml
# overrides the command). Same image for both, so the migrations that run
# are exactly the ones the new code was built against.

# ---- build: everything, dev dependencies included -------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Manifests first, so the npm install layer is reused until a dependency
# actually changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
# `npm ls` afterwards because npm 10 can report "Exit handler never
# called!" after a failed download and still exit 0 — the build would
# then fail two steps later with a baffling "tsc: not found".
RUN npm ci --no-audit --no-fund && npm ls --all >/dev/null

COPY packages ./packages
RUN npm run build

# ---- runtime: production dependencies and compiled output only ------------
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
# The web app is static files by now, so its dependencies (React and the
# rest) aren't installed here.
RUN npm ci --omit=dev --no-audit --no-fund -w @nmbm/shared -w @nmbm/db -w @nmbm/api \
  && npm ls --omit=dev -w @nmbm/api >/dev/null \
  && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/db/dist packages/db/dist
# migrate.js reads the SQL from ../src/migrations, relative to itself.
COPY --from=build /app/packages/db/src/migrations packages/db/src/migrations
COPY --from=build /app/packages/api/dist packages/api/dist
COPY --from=build /app/packages/web/dist packages/web/dist

# Never as root.
USER node
EXPOSE 8080
CMD ["node", "packages/api/dist/server.js"]
