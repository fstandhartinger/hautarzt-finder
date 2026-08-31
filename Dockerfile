FROM node:20-alpine

WORKDIR /app

# Coolify's rolling-deploy healthcheck runs curl inside the container.
RUN apk add --no-cache curl

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./
COPY data ./data
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server.js"]
