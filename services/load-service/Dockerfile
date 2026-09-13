FROM node:20-slim
RUN corepack enable && corepack prepare pnpm@9.7.1 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY services/load-service/package.json services/load-service/
RUN pnpm install --no-frozen-lockfile --filter load-service... --filter @truckmafia/shared

COPY packages/shared packages/shared
COPY services/load-service services/load-service
COPY tsconfig.base.json ./

EXPOSE 4002
CMD ["pnpm", "--filter", "load-service", "exec", "tsx", "src/index.ts"]
