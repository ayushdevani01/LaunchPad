FROM golang:1.26.10-bookworm AS compiler
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/build-server ./cmd/build-server
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /build-server ./cmd/build-server

# Node runs users' package managers and Next.js compilation. The worker itself
# is Go. glibc matches the native Linux dependencies used by AWS Lambda.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /home/app
RUN mkdir /home/app/work && chown -R node:node /home/app
COPY --from=compiler /build-server /usr/local/bin/build-server
USER node
ENTRYPOINT ["/usr/local/bin/build-server"]
