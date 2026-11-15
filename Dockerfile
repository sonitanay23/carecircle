# syntax=docker/dockerfile:1
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# Files are owned by the unprivileged "node" user, so it can read them whatever
# permissions they had on the developer's machine.
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
# Run as the unprivileged user that ships with the node image.
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
