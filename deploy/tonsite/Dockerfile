# TON Site for achivator.ton: tonutils-reverse-proxy
# (https://github.com/tonutils/reverse-proxy) built from a pinned release.
# It answers RLDP-HTTP requests from the TON network (Telegram's in-app
# browser, Tonkeeper, TON Proxy) and forwards them to PROXY_PASS as plain HTTP.
# Setup and the Coolify resource: docs/DEPLOY.md, "TON Site (achivator.ton)".

# The Debian golang image ships git.
FROM golang:1.26 AS build

# Bump both together; the build fails if the tag no longer points at the
# commit, so a moved tag never ships unreviewed code.
ARG PROXY_VERSION=v0.6.0
ARG PROXY_COMMIT=300fc0ced8eab48ff5879ce822419d42b8e3a43e

WORKDIR /src
RUN git clone --depth 1 --branch "$PROXY_VERSION" https://github.com/tonutils/reverse-proxy.git . \
 && test "$(git rev-parse HEAD)" = "$PROXY_COMMIT"
# go.sum pins every dependency.
RUN go mod download && go mod verify
RUN CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w -X main.GitCommit=$PROXY_VERSION" \
      -o /out/tonutils-reverse-proxy ./cmd/proxy \
 && mkdir /out/data

# Static, with CA certificates (the proxy downloads the TON network config
# over HTTPS) and no shell. Runs as uid 65532.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/tonutils-reverse-proxy /usr/local/bin/tonutils-reverse-proxy
# The proxy reads and writes ./config.json, which holds the private key of
# the site's ADNL address. Mount a volume here: a new key is a new address,
# and achivator.ton keeps pointing at the old one until its record is changed.
COPY --from=build --chown=65532:65532 /out/data /data
WORKDIR /data
ENTRYPOINT ["/usr/local/bin/tonutils-reverse-proxy"]
CMD ["-tx-url"]
