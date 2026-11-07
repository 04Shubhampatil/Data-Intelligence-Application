// Path router for brtechnobizz.tech (CloudPanel VPS).
//
// nginx sends every request for the domain to 127.0.0.1:3000. This router listens there and forwards:
//   /resourcedata, /resourcedata/*  ->  Data Intelligence   (127.0.0.1:3010, Next.js basePath /resourcedata)
//   everything else (incl. /egram)  ->  MahaPanchayat       (127.0.0.1:3002, Next.js basePath /egram)
//
// Paths are forwarded unchanged (no prefix is stripped): both apps expect their own prefix.
// The Host header and nginx's X-Forwarded-* headers are kept, so each app builds its own absolute URLs and
// redirects exactly as before (no Location rewriting, so no redirect loops). WebSocket upgrades are proxied.
"use strict";

const http = require("node:http");
const httpProxy = require("http-proxy");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const RESOURCEDATA = process.env.RESOURCEDATA_TARGET || "http://127.0.0.1:3010";
const MAHAPANCHAYAT = process.env.MAHAPANCHAYAT_TARGET || "http://127.0.0.1:3002";
const PREFIX = "/resourcedata";

/** Which upstream serves this URL. Only "/resourcedata" itself or "/resourcedata/…" / "?…" match (not "/resourcedataX"). */
function targetFor(url = "/") {
  const path = url.split("?")[0];
  return path === PREFIX || path.startsWith(`${PREFIX}/`) ? RESOURCEDATA : MAHAPANCHAYAT;
}

const proxy = httpProxy.createProxyServer({
  xfwd: false, // nginx already set X-Forwarded-For/Proto/Host; keep them as they are
  changeOrigin: false, // keep Host: brtechnobizz.tech (apps use it for redirects and auth)
  ws: true,
  proxyTimeout: 300_000, // matches nginx's 300 s for long exports
  timeout: 300_000,
});

proxy.on("error", (err, req, res) => {
  const target = targetFor(req.url);
  console.error(`[router] ${req.method} ${req.url} -> ${target} failed: ${err.code || err.message}`);
  if (res && typeof res.writeHead === "function" && !res.headersSent) {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("The application is temporarily unavailable. Please try again in a moment.");
  } else if (res && typeof res.destroy === "function") {
    res.destroy(); // a WebSocket socket, or a response already in flight
  }
});

const server = http.createServer((req, res) => proxy.web(req, res, { target: targetFor(req.url) }));
server.on("upgrade", (req, socket, head) => proxy.ws(req, socket, head, { target: targetFor(req.url) }));
server.keepAliveTimeout = 65_000; // longer than nginx's upstream keepalive, avoids resets on reused connections
server.headersTimeout = 66_000;

server.listen(PORT, HOST, () => {
  console.log(`[router] listening on ${HOST}:${PORT}  ${PREFIX} -> ${RESOURCEDATA}  * -> ${MAHAPANCHAYAT}`);
  if (typeof process.send === "function") process.send("ready"); // pm2 wait_ready
});

function shutdown(signal) {
  console.log(`[router] ${signal}: closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = { targetFor };
