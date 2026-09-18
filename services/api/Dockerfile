FROM golang:1.26.5-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /ledger ./cmd/ledger && \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /worker ./cmd/worker

RUN CGO_ENABLED=0 go build -trimpath -o /out/issuing-admin ./cmd/issuing-admin
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/cregis-readonly ./cmd/cregis-readonly
RUN CGO_ENABLED=0 go build -trimpath -o /out/issuing-worker ./cmd/issuing-worker
FROM alpine:3.23
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
COPY --from=build /api /ledger /worker /usr/local/bin/
USER app
EXPOSE 8870
COPY --from=build /out/issuing-admin /usr/local/bin/issuing-admin
COPY --from=build /out/cregis-readonly /usr/local/bin/cregis-readonly
COPY --from=build /out/issuing-worker /usr/local/bin/issuing-worker
ENTRYPOINT ["api"]
