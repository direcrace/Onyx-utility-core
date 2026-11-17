FROM node:22-bookworm-slim AS deps

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    DATABASE_URL=/app/data/database.db \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    BOT_PREFIX=. \
    NODE_OPTIONS=--max-old-space-size=768

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json index.js config.js clear.js ./
COPY --chown=node:node src ./src

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
VOLUME ["/app/data"]
EXPOSE 3000

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 \
  CMD node -e "const p=process.env.ADMIN_HTTP_PORT;if(!p)process.exit(0);fetch('http://127.0.0.1:'+p+'/health').then(r=>r.json()).then(j=>process.exit(j&&j.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]