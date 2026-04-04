FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
