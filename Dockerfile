FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Config and forms are written here; mount a volume to persist them.
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 3000

# Liveness check the deployer/orchestrator can read.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["node", "server.js"]
