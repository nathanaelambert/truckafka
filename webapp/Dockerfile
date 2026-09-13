FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.7.1 --activate

FROM base AS build
WORKDIR /app
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY webapp/package.json webapp/
RUN pnpm install --no-frozen-lockfile --filter webapp... --filter @truckmafia/shared
COPY packages/shared packages/shared
COPY webapp webapp
COPY tsconfig.base.json ./
RUN pnpm --filter webapp build

FROM nginx:alpine AS runner
COPY --from=build /app/webapp/dist /usr/share/nginx/html
COPY webapp/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
