FROM golang:1.26.5-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /ledger ./cmd/ledger && \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /worker ./cmd/worker

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
COPY --from=build /api /ledger /worker /usr/local/bin/
USER app
EXPOSE 8870
ENTRYPOINT ["api"]
