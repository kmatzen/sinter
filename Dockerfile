FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV VITE_EDITION=paid
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package*.json ./
COPY --from=build /app/tsconfig.json ./
RUN npm ci --omit=dev
RUN mkdir -p /data
EXPOSE 3000
ENV NODE_ENV=production
ENV DATA_DIR=/data
CMD ["node_modules/.bin/tsx", "server/index.ts"]
