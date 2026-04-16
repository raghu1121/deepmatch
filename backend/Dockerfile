# ---- Backend Dockerfile ----
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy application source
COPY server.js ./

# SQLite data will live in a mounted volume
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "server.js"]
