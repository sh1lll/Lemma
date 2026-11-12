# Lemma sync server. No dependencies: Node runs the TypeScript sources directly (type stripping, Node >= 22.18).
# Build from this folder:  docker build -t lemma-sync .
FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 DATA_DIR=/data
WORKDIR /app
COPY package.json ./
COPY src ./src
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "src/main.ts"]
