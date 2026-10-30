#!/bin/sh
# Dev tunnel over localtunnel (no account, no token). Exposes the web container;
# the public URL is printed to the log: docker compose logs tunnel
#
#   TUNNEL_HOST  host to expose (default web)
#   TUNNEL_PORT  port to expose (default 80)
set -u

while true; do
  echo "tunnel: connecting localtunnel -> ${TUNNEL_HOST:-web}:${TUNNEL_PORT:-80}"
  npx --yes localtunnel --local-host "${TUNNEL_HOST:-web}" --port "${TUNNEL_PORT:-80}"
  echo "tunnel: connection lost, retrying in 5s"
  sleep 5
done
