# PDF Diff - static build served by unprivileged nginx.
# Build context is the repository root:  docker compose -f deploy/docker-compose.yml build

# --- 1. Build the Vite app -------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /src/app
COPY app/package.json app/package-lock.json ./
# Playwright browsers are only needed for e2e tests, never in the image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --no-audit --no-fund
COPY app/ ./
RUN npm run build

# --- 2. Serve dist/ ----------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/app/dist /usr/share/nginx/html
# Image runs as uid 101 (nginx) and listens on 8080.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
