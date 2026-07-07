# ── Stage 1: build the server (TypeScript → dist) ───────────────────
FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build

# ── Stage 2: runtime ────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only production deps (includes the prisma CLI for db push at boot).
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate

# App code + static assets (dashboard + overlay).
COPY --from=build /app/dist ./dist
COPY public ./public
COPY docker/app-entrypoint.sh /app-entrypoint.sh
RUN chmod +x /app-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/app-entrypoint.sh"]
