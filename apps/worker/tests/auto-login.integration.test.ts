/**
 * Automatic source sign-in against a FAKE MahaHRD login page served locally (same form ids, JSON POST to /login,
 * red message on refusal, redirect to /dashboard). Real headless browser + MySQL; synthetic data, cleaned up.
 * No request ever goes to the real MahaHRD.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

const LOGIN_PAGE = `<!doctype html><html><body>
<form id="loginForm"><input type="text" id="username"><input type="password" id="password"><button type="submit">Log In</button></form>
<div class="login_message"></div>
<script>
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await fetch("/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emp_username: document.getElementById("username").value, emp_password: document.getElementById("password").value, device_type: "ERP" }) });
  if (r.ok) { document.querySelector(".login_message").innerHTML = "<p style='color:green'>Login Successful ! Redirecting...</p>"; setTimeout(() => { location.href = "/dashboard"; }, 300); }
  else { const j = await r.json(); document.querySelector(".login_message").innerHTML = "<p style='color:red'>" + j.messages.error + "</p>"; }
});
</script></body></html>`;

describe.skipIf(!hasDb)("automatic source sign-in (fake MahaHRD, real browser)", async () => {
  const { prisma } = await import("@di/db");
  const { encryptSecret, sourceCredentialsAad } = await import("@di/core");
  const { autoLogin, loadCredentials } = await import("../src/browser/auto-login");
  const { loadSession } = await import("../src/browser/session");
  const { launchBrowser } = await import("../src/browser/launch");

  const TAG = `ZZAUTOLOGIN-${Date.now()}`;
  const seen: { path: string; body: string }[] = [];
  let server: http.Server;
  let base = "";
  let connId = "";
  let browserOk = true;

  beforeAll(async () => {
    try {
      await (await launchBrowser({ headless: true })).close();
    } catch {
      browserOk = false; // no Chromium/Edge on this machine: the browser tests are skipped below
    }
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ path: req.url ?? "", body });
        if (req.method === "POST" && req.url === "/login") {
          const { emp_username, emp_password } = JSON.parse(body || "{}");
          if (emp_username === "synth-admin" && emp_password === "Right-Passw0rd") {
            res.writeHead(200, { "content-type": "application/json", "set-cookie": "ci_session=synthetic; Path=/; HttpOnly" });
            return res.end(JSON.stringify({ access_token: "synthetic" }));
          }
          res.writeHead(401, { "content-type": "application/json" });
          return res.end(JSON.stringify({ messages: { error: "Invalid Username or Password!" } }));
        }
        if (req.url?.startsWith("/dashboard")) {
          res.writeHead(200, { "content-type": "text/html" });
          return res.end(`<html><body><a href="/employee-records">Records</a></body></html>`);
        }
        res.writeHead(200, { "content-type": "text/html" });
        res.end(LOGIN_PAGE);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    connId = (await prisma.sourceConnection.create({ data: { name: TAG, adapterKey: "mahahrd", baseUrl: base } })).id;
  });

  afterAll(async () => {
    await prisma.sourceConnection.deleteMany({ where: { id: connId } });
    await new Promise((r) => server.close(r));
  });

  const savePassword = (password: string) =>
    prisma.sourceConnection.update({
      where: { id: connId },
      data: { authMode: "CREDENTIALS", username: "synth-admin", encryptedSecret: encryptSecret(password, undefined, sourceCredentialsAad(connId)) },
    });

  it("without saved credentials nothing is attempted and the reason is recorded", async () => {
    expect(await loadCredentials(connId)).toBeNull();
    const r = await autoLogin(connId, () => {});
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("No MahaHRD username and password") });
  });

  it("the saved password is stored encrypted and only readable by the worker for this connection", async () => {
    await savePassword("Right-Passw0rd");
    const row = await prisma.sourceConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(row.encryptedSecret).not.toContain("Right-Passw0rd");
    expect(await loadCredentials(connId)).toEqual({ username: "synth-admin", password: "Right-Passw0rd" });
  });

  it("a refused password reports the source's own message and saves no session", async (ctx) => {
    if (!browserOk) return ctx.skip();
    await savePassword("Wrong-Passw0rd");
    const r = await autoLogin(connId, () => {});
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("Invalid Username or Password!") });
    const row = await prisma.sourceConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(row.autoLoginError).toContain("Invalid Username or Password!");
    expect(row.encryptedSession).toBeNull();
    expect(JSON.stringify(row)).not.toContain("Wrong-Passw0rd");
  }, 60_000);

  it("the right password signs in through the guarded browser and saves the session encrypted", async (ctx) => {
    if (!browserOk) return ctx.skip();
    await savePassword("Right-Passw0rd");
    seen.length = 0;
    const r = await autoLogin(connId, () => {});
    expect(r).toEqual({ ok: true });
    expect(seen.some((s) => s.path === "/login")).toBe(true); // the login POST got past the read-only guard
    const row = await prisma.sourceConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(row.autoLoginAt).not.toBeNull();
    expect(row.autoLoginError).toBeNull();
    const session = await loadSession(connId);
    expect(session?.cookies.map((c) => c.name)).toContain("ci_session");
  }, 60_000);
});
