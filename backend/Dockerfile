FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --omit=dev
COPY src ./src
ENV PORT=4000
EXPOSE 4000
CMD ["npm","start"]
