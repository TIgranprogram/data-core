FROM node:20-alpine AS deps
WORKDIR /app
# Pin pnpm 9.x via corepack: latest pnpm (10+/11+) auto-fetched by corepack on
# Node 20.20-alpine triggers `ERR_UNKNOWN_BUILTIN_MODULE`. Same pin is mirrored
# in package.json#packageManager — update BOTH on bump.
RUN corepack enable && corepack prepare pnpm@9.15.0
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
# Quotation PDF (puppeteer-core): Chromium + Cyrillic fonts in prod image.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-dejavu \
    font-noto \
    font-noto-cjk
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
# prod stage doesn't need pnpm or corepack — CMD invokes `node`, not pnpm scripts.
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
# TZ-BACKEND-DOCSTUDIO-BLOCK-STYLE — self-hosted @font-face files (dev+prod images
# share no system font set; render loads these for typeface parity in PDF).
COPY --from=build /app/assets ./assets
COPY package.json ./
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
