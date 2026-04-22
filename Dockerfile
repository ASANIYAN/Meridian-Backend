# Build
FROM node:25-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production
FROM node:25-alpine AS production

# Create non-root user
RUN addgroup -S meridian && adduser -S meridian -G meridian

WORKDIR /app

# Install production deps only
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Own the files as the meridian user
RUN chown -R meridian:meridian /app

# Switch to non-root user
USER meridian

EXPOSE 3000

CMD ["node", "dist/main.js"]