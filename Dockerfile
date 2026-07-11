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

# System deps:
#  - openssl/ca-certificates: required by the Prisma query engine
#  - python3/pip + espeak-ng: run the bundled Piper TTS HTTP server in-container
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       openssl ca-certificates python3 python3-pip espeak-ng \
  && rm -rf /var/lib/apt/lists/*

# Piper TTS with the HTTP server extras (served on 127.0.0.1:5000 at runtime).
RUN pip install --no-cache-dir --break-system-packages "piper-tts[http]"

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

# Report container health from /healthz (503 when Piper is down). Uses Node
# since the slim image has no curl. Generous start period: first boot runs
# prisma db push and downloads Piper voices, which can take a minute.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app-entrypoint.sh"]
