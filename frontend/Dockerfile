# ClassQuest web image. Build context is frontend/:
#   docker build --build-arg VITE_API_URL=http://localhost:8000 -t classquest-web frontend
# Dokploy: Dockerfile=frontend/Dockerfile, build context=frontend/, build-arg VITE_API_URL.
# node:20-alpine and nginx:alpine both ship linux/arm64 (Oracle aarch64 box).

# ---- stage 1: build the static bundle ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* at build time, so the API URL is a build-arg, not a
# runtime env var. Changing it means rebuilding the image.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---- stage 2: serve with nginx ----
FROM nginx:alpine AS serve
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
