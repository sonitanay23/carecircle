# syntax=docker/dockerfile:1
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
# Run as the unprivileged user that ships with the node image.
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
