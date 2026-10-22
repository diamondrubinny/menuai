# syntax=docker/dockerfile:1
# MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
# Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
# Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
# MenuAI API server. The editor itself is static and is served by nginx from dist/.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run server:build
# sharp (image re-encoding) ships native libvips binaries, so it is installed next to the bundle
# instead of being bundled: only sharp, at the exact version locked in package-lock.json.
RUN mkdir /deps && cd /deps && echo '{"private":true}' > package.json \
 && npm install --omit=dev --no-audit --no-fund --no-package-lock "sharp@$(node -p "require('/app/node_modules/sharp/package.json').version")"

# The server is bundled into one file with all its dependencies: no node_modules,
# no npm, no editor packages in the runtime image (smaller and less to attack).
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /deps/node_modules ./node_modules
# Writable data lives in volumes, never inside the image.
RUN mkdir -p /var/lib/menuai/published /var/lib/menuai/uploads && chown -R node:node /var/lib/menuai
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 --start-period=20s --start-interval=2s \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist-server/main.mjs"]
