FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

RUN mkdir -p /app/data \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/server.js"]
