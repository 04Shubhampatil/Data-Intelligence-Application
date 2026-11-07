// Quick self-check of the routing rule (no network): node test-routing.js
"use strict";
process.env.PORT = "0"; // never bind 3000 from a test
const assert = require("node:assert");
const { targetFor } = require("./router.js");

const RD = "http://127.0.0.1:3010", MP = "http://127.0.0.1:3002";
for (const [url, want] of [
  ["/resourcedata", RD], ["/resourcedata/", RD], ["/resourcedata/login?callbackUrl=%2F", RD],
  ["/resourcedata/_next/static/x.css", RD], ["/resourcedata?x=1", RD],
  ["/egram", MP], ["/egram/", MP], ["/egram/admin/login", MP], ["/", MP],
  ["/resourcedataX", MP], ["/resource", MP], ["/.well-known/acme-challenge/t", MP],
]) assert.strictEqual(targetFor(url), want, url);
console.log("routing rules ok");
process.exit(0);
