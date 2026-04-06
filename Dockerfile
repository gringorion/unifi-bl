FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

RUN apk upgrade --no-cache zlib \
  && apk add --no-cache --upgrade \
    --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main \
    busybox=1.37.0-r31 \
  && mkdir -p /app/data \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/server.js"]
