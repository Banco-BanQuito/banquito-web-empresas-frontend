FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ARG VITE_PARTY_API_BASE_URL=http://localhost:8083
ARG VITE_API_BASE_URL=http://localhost:8000
RUN printf "VITE_PARTY_API_BASE_URL=%s\nVITE_API_BASE_URL=%s\n" \
    "$VITE_PARTY_API_BASE_URL" "$VITE_API_BASE_URL" \
    > .env.production.local

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
