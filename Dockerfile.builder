# Dockerfile.builder
FROM node:18 AS builder
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

