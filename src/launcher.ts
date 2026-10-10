import { spawn } from "node:child_process";

export interface OpenCommand {
  command: string;
  args: string[];
}

/** The platform command that opens `url` in the user's default browser. */
export function browserOpenCommand(url: string, platform: NodeJS.Platform = process.platform): OpenCommand {
  if (platform === "win32") {
    // `start` is a cmd built-in; the empty "" is the window title it would
    // otherwise swallow the URL as.
    return { command: "cmd", args: ["/c", "start", '""', url] };
  }
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  return { command: "xdg-open", args: [url] };
}

/** Opens the default browser at `url`. Never throws: the tracker works fine without it, the user just opens the address themselves. */
export function openBrowser(url: string): void {
  const { command, args } = browserOpenCommand(url);
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsVerbatimArguments: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Ignored on purpose — see above.
  }
}

/**
 * True if a Tarkov Storyline Tracker is already answering on `port`. Used so
 * that clicking the shortcut twice just opens the browser again instead of
 * failing with "address already in use".
 */
export async function isTrackerRunning(port: number, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as Record<string, unknown>;
    return typeof body === "object" && body !== null && "lastWatcherPollAt" in body;
  } catch {
    return false;
  }
}

export function shouldOpenBrowser(argv: string[], env: NodeJS.ProcessEnv): boolean {
  return !argv.includes("--no-open") && env.TARKOV_NO_OPEN !== "1";
}
