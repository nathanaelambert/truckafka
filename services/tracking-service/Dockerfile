FROM node:20-slim
RUN corepack enable && corepack prepare pnpm@9.7.1 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY services/tracking-service/package.json services/tracking-service/
RUN pnpm install --no-frozen-lockfile --filter tracking-service... --filter @truckmafia/shared

COPY packages/shared packages/shared
COPY services/tracking-service services/tracking-service
COPY tsconfig.base.json ./

EXPOSE 4003
CMD ["pnpm", "--filter", "tracking-service", "exec", "tsx", "src/index.ts"]
