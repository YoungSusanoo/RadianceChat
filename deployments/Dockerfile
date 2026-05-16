FROM node:20-alpine AS frontend
WORKDIR /src/web/app
COPY web/app/package*.json ./
RUN npm ci
COPY web/app ./
RUN npm run build

FROM golang:1.24 AS backend
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -o /out/radiance ./cmd/radiance

FROM node:20-alpine
WORKDIR /app
COPY --from=backend /out/radiance /app/radiance
COPY --from=frontend /src/web/app/dist /app/web
ENV RADIANCE_ADDR=:8080
ENV RADIANCE_STATIC_DIR=/app/web
ENV RADIANCE_DATA_FILE=/app/data/radiance.json
EXPOSE 8080
CMD ["/app/radiance"]
