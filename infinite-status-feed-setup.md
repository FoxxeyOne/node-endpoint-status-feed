# Infinite Endpoint Status Feed Setup (Secure)

This guide lets an Infinite node operator run a small status service that checks their own endpoints and exposes a **read-only JSON feed** for websites (such as `foxxone.one`) to consume.

## What this service does

- Probes Infinite endpoints from the server side (no browser CORS issues)
- Returns JSON at `/endpoint-status`
- Includes mainnet + testnet checks for:
  - EVM RPC (JSON-RPC)
  - Comet RPC (`/status`)
  - gRPC (TCP connectivity check)

## Security design (important)

- Binds to `127.0.0.1` by default (not public directly)
- Expose it through nginx/Caddy over HTTPS
- Read-only endpoints only (`GET /endpoint-status`, `GET /healthz`)
- No write/admin routes
- CORS restricted to allowed origins (for example `https://foxxone.one`)

## Files to copy

From this repo:

- `ops/infinite-endpoint-status-proxy.mjs`
- `ops/infinite-endpoint-status.env.example`

## Prerequisites

- Ubuntu/Debian server
- Node.js 18+ (`node -v`)
- nginx (or Caddy) already handling TLS for your domain
- Optional: `pm2` or `systemd` for process management

## 1. Create a service directory

```bash
mkdir -p ~/infinite-status
cd ~/infinite-status
```

Copy the script into this folder and save it as:

```bash
~/infinite-status/infinite-endpoint-status-proxy.mjs
```

## 2. Create the environment file

Create `~/infinite-status/.env` using the example values.

Minimal example:

```bash
cat > ~/infinite-status/.env <<'EOF'
BIND_HOST=127.0.0.1
PORT=8788
CORS_ORIGIN=https://foxxone.one
REQUEST_TIMEOUT_MS=7000

INFINITE_EVM_URL=https://evm-rpc.infinitedrive.xyz
INFINITE_COMET_URL=https://comet-rpc.infinitedrive.xyz
INFINITE_GRPC_HOST=grpc.infinitedrive.xyz
INFINITE_GRPC_PORT=443

INFINITE_EVM_TESTNET_URL=https://evm-rpc-testnet.infinitedrive.xyz
INFINITE_COMET_TESTNET_URL=https://comet-rpc-testnet.infinitedrive.xyz
INFINITE_GRPC_TESTNET_HOST=grpc-testnet.infinitedrive.xyz
INFINITE_GRPC_TESTNET_PORT=443
EOF
```

Lock down file permissions:

```bash
chmod 600 ~/infinite-status/.env
```

## 3. Test run manually

```bash
cd ~/infinite-status
set -a
source ./.env
set +a
node ./infinite-endpoint-status-proxy.mjs
```

In another shell (same server):

```bash
curl http://127.0.0.1:8788/healthz
curl http://127.0.0.1:8788/endpoint-status
```

Expected shape:

```json
{
  "checked_at": "2026-02-24T00:00:00.000Z",
  "source": "server",
  "statuses": {
    "infinite-evm": { "status": "UP", "detail": "Latency 120ms", "latency_ms": 120 },
    "infinite-comet": { "status": "UP", "detail": "Latency 85ms", "latency_ms": 85 },
    "infinite-grpc": { "status": "UP", "detail": "Latency 30ms", "latency_ms": 30 }
  }
}
```

## 4A. Run with PM2 (simple)

```bash
cd ~/infinite-status
set -a
source ./.env
set +a
pm2 start ./infinite-endpoint-status-proxy.mjs --name infinite-endpoint-status --update-env
pm2 save
```

Check:

```bash
pm2 status
pm2 logs infinite-endpoint-status --lines 100
```

## 4B. Run with systemd (alternative)

Create `/etc/systemd/system/infinite-endpoint-status.service`:

```ini
[Unit]
Description=Infinite Endpoint Status Proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/infinite-status
EnvironmentFile=/home/ubuntu/infinite-status/.env
ExecStart=/usr/bin/node /home/ubuntu/infinite-status/infinite-endpoint-status-proxy.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Enable/start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now infinite-endpoint-status
sudo systemctl status infinite-endpoint-status
```

## 5. nginx reverse proxy (recommended)

Expose only the public JSON endpoints via nginx over HTTPS.

Example (inside your TLS server block for your domain):

```nginx
location = /endpoint-status {
    proxy_pass http://127.0.0.1:8788/endpoint-status;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 15s;
}

location = /healthz {
    proxy_pass http://127.0.0.1:8788/healthz;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 5s;
}
```

Test and reload nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Firewall guidance

- Do **not** open the proxy app port (`8788`) publicly
- Keep it bound to `127.0.0.1`
- Only expose HTTPS (`443`) through nginx/Caddy

## 7. CORS guidance

Set `CORS_ORIGIN` to the exact site(s) that should read the feed.

Examples:

- `https://foxxone.one`
- `https://foxxone.one,https://www.foxxone.one`

Avoid `*` unless you intentionally want any website to consume the feed.

## 8. Troubleshooting

### `DOWN` for EVM/Comet

- Confirm local endpoint URLs in `.env`
- Check SSL/TLS and DNS
- Increase `REQUEST_TIMEOUT_MS` if the node is slow

### `DOWN` for gRPC

- Confirm host/port are correct (`443`, `9090`, or your custom port)
- Confirm firewall allows that port
- Confirm the node process is actually listening on that port

### Feed works locally but not publicly

- Check nginx location blocks
- Check HTTPS certificate/domain
- Confirm `CORS_ORIGIN` includes the frontend domain

## 9. Integration note for websites

Frontend pages should call:

- `https://<operator-domain>/endpoint-status`

and consume the `statuses` object keys:

- `infinite-evm`
- `infinite-comet`
- `infinite-grpc`
- `infinite-evm-testnet`
- `infinite-comet-testnet`
- `infinite-grpc-testnet`
