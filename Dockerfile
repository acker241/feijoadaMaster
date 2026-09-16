# Feijoada do Master — site + backend em um unico servico
# Debian slim, nao Alpine: o motor do modelo de embeddings (onnxruntime) precisa de glibc
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json server/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund; else npm install --omit=dev --no-audit --no-fund; fi

COPY server/ ./
COPY index.html ./public/index.html

# baixa o modelo de embeddings no build, para a triagem nao depender de download em producao
RUN node embeddings.js

EXPOSE 8080
CMD ["node", "server.js"]
