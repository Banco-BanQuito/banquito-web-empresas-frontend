FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm config set strict-ssl false && npm install --include=dev --no-audit --no-fund
COPY . .

ARG VITE_PARTY_API_BASE_URL=https://136.68.89.25.nip.io
ARG VITE_API_BASE_URL=https://136.68.89.25.nip.io
ARG VITE_IDENTITY_PLATFORM_API_KEY=
ARG VITE_APIGEE_API_KEY=
ENV VITE_PARTY_API_BASE_URL=$VITE_PARTY_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_IDENTITY_PLATFORM_API_KEY=$VITE_IDENTITY_PLATFORM_API_KEY
ENV VITE_APIGEE_API_KEY=$VITE_APIGEE_API_KEY
RUN test -n "$VITE_IDENTITY_PLATFORM_API_KEY"
RUN printf "export const buildEnv = {\\n  identityPlatformApiKey: '%s',\\n  apigeeApiKey: '%s'\\n};\\n" \
    "$VITE_IDENTITY_PLATFORM_API_KEY" "$VITE_APIGEE_API_KEY" \
    > src/build-env.ts
RUN printf "VITE_PARTY_API_BASE_URL=%s\nVITE_API_BASE_URL=%s\nVITE_IDENTITY_PLATFORM_API_KEY=%s\nVITE_APIGEE_API_KEY=%s\n" \
    "$VITE_PARTY_API_BASE_URL" "$VITE_API_BASE_URL" "$VITE_IDENTITY_PLATFORM_API_KEY" "$VITE_APIGEE_API_KEY" \
    > .env.production.local

RUN npm run build
RUN grep -R "signInWithPassword?key=$VITE_IDENTITY_PLATFORM_API_KEY" /app/dist/assets >/dev/null

FROM nginxinc/nginx-unprivileged:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
