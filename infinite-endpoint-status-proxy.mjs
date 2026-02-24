#!/usr/bin/env node
import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.PORT || 8788);
const BIND_HOST = process.env.BIND_HOST || "127.0.0.1";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 7000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "https://foxxone.one";
const ALLOW_ORIGINS = CORS_ORIGIN.split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const CHECKS = [
  { id: "infinite-evm", kind: "jsonrpc", url: process.env.INFINITE_EVM_URL || "https://evm-rpc.infinitedrive.xyz" },
  { id: "infinite-comet", kind: "tendermint", url: process.env.INFINITE_COMET_URL || "https://comet-rpc.infinitedrive.xyz" },
  {
    id: "infinite-grpc",
    kind: "tcp",
    host: process.env.INFINITE_GRPC_HOST || "grpc.infinitedrive.xyz",
    port: Number(process.env.INFINITE_GRPC_PORT || 443)
  },
  {
    id: "infinite-evm-testnet",
    kind: "jsonrpc",
    url: process.env.INFINITE_EVM_TESTNET_URL || "https://evm-rpc-testnet.infinitedrive.xyz"
  },
  {
    id: "infinite-comet-testnet",
    kind: "tendermint",
    url: process.env.INFINITE_COMET_TESTNET_URL || "https://comet-rpc-testnet.infinitedrive.xyz"
  },
  {
    id: "infinite-grpc-testnet",
    kind: "tcp",
    host: process.env.INFINITE_GRPC_TESTNET_HOST || "grpc-testnet.infinitedrive.xyz",
    port: Number(process.env.INFINITE_GRPC_TESTNET_PORT || 443)
  }
];

function resolveAllowedOrigin(requestOrigin) {
  if (!ALLOW_ORIGINS.length) return "*";
  if (ALLOW_ORIGINS.includes("*")) return "*";
  if (!requestOrigin) return ALLOW_ORIGINS[0];
  if (ALLOW_ORIGINS.includes(requestOrigin)) return requestOrigin;
  return ALLOW_ORIGINS[0];
}

function jsonHeaders(requestOrigin) {
  const allowOrigin = resolveAllowedOrigin(requestOrigin);
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

async function probeJsonRpc(url) {
  const start = Date.now();
  const res = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "web3_clientVersion",
        params: []
      })
    }),
    REQUEST_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error.message || "json-rpc error");
  return Date.now() - start;
}

async function probeTendermintStatus(url) {
  const start = Date.now();
  const res = await withTimeout(fetch(`${url}/status`), REQUEST_TIMEOUT_MS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Date.now() - start;
}

async function probeTcp(host, port) {
  const start = Date.now();
  await withTimeout(
    new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", reject);
    }),
    REQUEST_TIMEOUT_MS
  );
  return Date.now() - start;
}

async function runChecks() {
  const statuses = {};
  for (const check of CHECKS) {
    try {
      let latencyMs = 0;
      if (check.kind === "jsonrpc") latencyMs = await probeJsonRpc(check.url);
      if (check.kind === "tendermint") latencyMs = await probeTendermintStatus(check.url);
      if (check.kind === "tcp") latencyMs = await probeTcp(check.host, check.port);
      statuses[check.id] = {
        status: "UP",
        detail: `Latency ${latencyMs}ms`,
        latency_ms: latencyMs
      };
    } catch (err) {
      statuses[check.id] = {
        status: "DOWN",
        detail: err instanceof Error ? err.message : "request failed",
        latency_ms: null
      };
    }
  }

  return {
    checked_at: new Date().toISOString(),
    source: "server",
    statuses
  };
}

const server = http.createServer(async (req, res) => {
  const requestOrigin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const headers = jsonHeaders(requestOrigin);

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if (!req.url) {
    res.writeHead(400, headers);
    res.end(JSON.stringify({ error: "missing_url" }));
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method !== "GET") {
    res.writeHead(405, headers);
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  if (pathname === "/healthz") {
    res.writeHead(200, headers);
    res.end(JSON.stringify({ ok: true, uptime_s: Math.round(process.uptime()) }));
    return;
  }

  if (pathname === "/endpoint-status") {
    try {
      const payload = await runChecks();
      res.writeHead(200, headers);
      res.end(JSON.stringify(payload));
    } catch (err) {
      res.writeHead(500, headers);
      res.end(
        JSON.stringify({
          error: "status_check_failed",
          detail: err instanceof Error ? err.message : "unknown error"
        })
      );
    }
    return;
  }

  res.writeHead(404, headers);
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(PORT, BIND_HOST, () => {
  console.log(`infinite-endpoint-status-proxy listening on ${BIND_HOST}:${PORT}`);
});
