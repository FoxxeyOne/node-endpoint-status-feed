# node-endpoint-status-feed
End point feed for Foxxone website integration. 
# Node Endpoint Status Feed (Infinite Example)

Small read-only Node.js service for publishing endpoint health as JSON.

Designed for node operators who want websites (such as FoxxOne) to consume a reliable server-side status feed without browser CORS issues.

## Features

- Server-side checks for:
  - EVM RPC (JSON-RPC)
  - Comet RPC (`/status`)
  - gRPC (TCP connectivity)
- Mainnet + testnet support
- Read-only JSON endpoints:
  - `/endpoint-status`
  - `/healthz`
- Localhost bind by default (`127.0.0.1`)
- Reverse-proxy friendly (nginx/Caddy)
- CORS allowlist support

## Quick Start

1. Copy `infinite-endpoint-status-proxy.mjs`
2. Copy `.env.example` to `.env` and edit values
3. Run:
   ```bash
   set -a && source ./.env && set +a
   node ./infinite-endpoint-status-proxy.mjs
