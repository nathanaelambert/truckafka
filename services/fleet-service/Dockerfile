FROM node:20-slim
RUN corepack enable && corepack prepare pnpm@9.7.1 --activate
WORKDIR /app

# Install dependencies
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY services/fleet-service/package.json services/fleet-service/
RUN pnpm install --no-frozen-lockfile --filter fleet-service... --filter @truckmafia/shared

# Copy source
COPY packages/shared packages/shared
COPY services/fleet-service services/fleet-service
COPY tsconfig.base.json ./

EXPOSE 4001
CMD ["pnpm", "--filter", "fleet-service", "exec", "tsx", "src/index.ts"]
