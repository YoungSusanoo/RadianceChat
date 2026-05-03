FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git gcc musl-dev

WORKDIR /app

COPY go.mod go.sum* ./

RUN go mod download && go mod tidy

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -mod=mod -o /radiance-bin main.go

FROM alpine:latest
WORKDIR /root/

COPY --from=builder /radiance-bin .
COPY .env .
COPY db ./db 

EXPOSE 8080
CMD ["./radiance-bin"]