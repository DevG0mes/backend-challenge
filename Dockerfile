FROM oven/bun:1.4.3 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:1.4.3-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER bun
EXPOSE 3000
CMD ["bun", "run", "dist/main.js"]
