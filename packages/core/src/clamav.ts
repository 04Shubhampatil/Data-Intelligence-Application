import net from "node:net";

/**
 * Minimal clamd INSTREAM client. Enabled when CLAMAV_HOST is set (e.g. "clamav:3310").
 * Returns "clean" | "infected" | "skipped" (no scanner configured) and throws on transport errors
 * so the caller can record FAILED instead of storing an unscanned file.
 */
export async function scanBytes(bytes: Uint8Array, host = process.env.CLAMAV_HOST): Promise<{ result: "clean" | "infected" | "skipped"; detail?: string }> {
  if (!host) return { result: "skipped" };
  const [hostname, portStr] = host.split(":");
  const port = Number(portStr || 3310);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: hostname, port }, () => {
      socket.write("zINSTREAM\0");
      const CHUNK = 64 * 1024;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const part = bytes.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length, 0);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.from([0, 0, 0, 0]));
    });
    let out = "";
    socket.setTimeout(60_000, () => { socket.destroy(); reject(new Error("clamd timeout")); });
    socket.on("data", (d) => (out += d.toString()));
    socket.on("error", reject);
    socket.on("close", () => {
      const line = out.replace(/\0/g, "").trim();
      if (/\bOK$/.test(line)) resolve({ result: "clean" });
      else if (/FOUND$/.test(line)) resolve({ result: "infected", detail: line });
      else reject(new Error(`clamd: ${line || "no response"}`));
    });
  });
}
