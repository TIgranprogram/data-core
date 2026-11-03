FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
COPY pwa ./pwa
COPY admin ./admin
COPY assets ./assets
COPY scripts/passport-texts.v2.json ./scripts/passport-texts.v2.json
RUN pnpm run build
ENV NODE_ENV=test
CMD ["node", "dist/src/main.js"]
