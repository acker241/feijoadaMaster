# Feijoada do Master — site + backend em um unico servico
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server/ ./
COPY index.html ./public/index.html

EXPOSE 8080
CMD ["node", "server.js"]
