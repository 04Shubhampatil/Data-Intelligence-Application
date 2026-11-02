import { spawn, type ChildProcess } from "node:child_process";

/**
 * Keeps the computer from idle-sleeping while a sync runs (a sleeping laptop silently pauses the
 * job for hours). It is a normal "work in progress" request, the same one media players and
 * installers make: no power setting is changed, a closed lid or "Sleep" still sleeps, and the
 * request ends as soon as the sync process exits (even if it crashes), because the helper exits
 * when its stdin closes.
 *
 * Windows: SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) in a small PowerShell helper.
 * macOS: `caffeinate -i -w <pid>`. Elsewhere: no-op. Disable with SYNC_KEEP_AWAKE=0.
 */
export function keepAwake(log?: (m: string) => void): () => void {
  if (process.env.SYNC_KEEP_AWAKE === "0") return () => {};
  let child: ChildProcess | null = null;
  try {
    if (process.platform === "win32") {
      const script = [
        "$t = Add-Type -Name P -Namespace W -PassThru -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'",
        "$null = $t::SetThreadExecutionState([uint32]'0x80000001')",
        "$null = [Console]::In.ReadToEnd()", // hold until the sync process goes away
      ].join("; ");
      child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
      });
    } else if (process.platform === "darwin") {
      child = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
    } else {
      return () => {};
    }
    child.on("error", () => log?.("could not keep the computer awake; it may sleep during the sync"));
    child.unref();
    (child.stdin as unknown as { unref?: () => void } | null)?.unref?.(); // never keeps the process alive on its own
    log?.("keeping the computer awake while the sync runs");
  } catch {
    return () => {};
  }
  return () => {
    child?.stdin?.end();
    child?.kill();
    child = null;
  };
}
