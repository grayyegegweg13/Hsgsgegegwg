# syntax=docker/dockerfile:1
# ---- Build the frontend ----
FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- Production image ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 STATIC_DIR=/app/frontend/dist
ARG GEMINI_CLI_VERSION=latest
# Gemini CLI is installed in the image, but NO credentials are baked in.
# Credentials are mounted at runtime from the host (see docker-compose.yml).
RUN npm install -g @google/gemini-cli@${GEMINI_CLI_VERSION} --no-audit --no-fund \
 && npm cache clean --force
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY backend/src ./src
COPY --from=frontend /build/dist /app/frontend/dist
# The image's built-in "node" user is uid 1000, which matches the first user on most Ubuntu hosts.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
