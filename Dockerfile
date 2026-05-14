FROM node:22-alpine

RUN apk add --no-cache docker-cli openssh-client sshpass

RUN mkdir -p /data && chmod 700 /data

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./server.js
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3980

EXPOSE 3980

CMD ["node", "server.js"]
