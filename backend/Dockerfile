FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# Copy source
COPY . .

# Generate Prisma client
RUN bunx prisma generate --config prisma/prisma.config.ts

# Expose port
EXPOSE 3700

# Start
CMD ["bun", "start"]
