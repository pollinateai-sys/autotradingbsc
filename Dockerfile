# ============================================================
#  Halal BSC Trading Bot — Docker image
#  Build:  docker build -t halal-bot .
#  Run:    docker run -d --env-file .env -p 3000:3000 --name halal-bot halal-bot
# ============================================================
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

# .env is supplied at runtime via --env-file, never baked into the image
RUN rm -f .env

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
