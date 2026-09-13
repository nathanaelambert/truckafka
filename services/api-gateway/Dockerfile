FROM node:20-slim
RUN corepack enable && corepack prepare pnpm@9.7.1 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY services/api-gateway/package.json services/api-gateway/
RUN pnpm install --no-frozen-lockfile --filter api-gateway... --filter @truckmafia/shared

COPY packages/shared packages/shared
COPY services/api-gateway services/api-gateway
COPY tsconfig.base.json ./

EXPOSE 4000
CMD ["pnpm", "--filter", "api-gateway", "exec", "tsx", "src/index.ts"]
