import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createServer } from "./createServer.js";

let server: Server | undefined;
let tempDir: string | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function baseUrl(): string {
  const port = (server!.address() as AddressInfo).port;
  return `http://localhost:${port}`;
}

describe("createServer", () => {
  it("serves the index file for the root path", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    writeFileSync(join(tempDir, "index.html"), "<h1>Hello</h1>");
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/`);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(text).toBe("<h1>Hello</h1>");
  });

  it("serves a nested static file by path with the right content type", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    writeFileSync(join(tempDir, "styles.css"), "body { color: red; }");
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/styles.css`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
  });

  it("returns 404 for a missing static file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/does-not-exist.html`);

    expect(response.status).toBe(404);
  });

  it("blocks a percent-encoded path-traversal attempt outside the static directory", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    // Percent-encoded so it survives to the server undecoded, the way a
    // crafted request (not a normal browser navigation, which a URL parser
    // would already have normalized) would reach it.
    const response = await fetch(`${baseUrl()}/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd`);

    expect([403, 404]).toContain(response.status);
  });

  it("returns 400 for a malformed percent-encoded path instead of hanging or crashing", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    // %e0%e0 is valid hex (so it passes the client's own URL parsing
    // untouched) but is not valid UTF-8, so decodeURIComponent throws
    // URIError: URI malformed when the server tries to decode it.
    const response = await fetch(`${baseUrl()}/%e0%e0`);

    expect(response.status).toBe(400);
  });

  it("routes a GET request to a matching API handler and returns JSON", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({
      apiRoutes: { "GET /api/hello": () => ({ message: "hi" }) },
      staticDir: tempDir,
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/api/hello`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ message: "hi" });
  });

  it("returns the handler's status code and message when an API handler throws", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({
      apiRoutes: {
        "GET /api/broken": () => {
          const error = new Error("nope") as Error & { status?: number };
          error.status = 400;
          throw error;
        },
      },
      staticDir: tempDir,
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/api/broken`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("nope");
  });

  it("defaults to a 500 status when a thrown error has no status", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({
      apiRoutes: {
        "GET /api/crash": () => {
          throw new Error("boom");
        },
      },
      staticDir: tempDir,
    });
    await new Promise<void>((resolve) => server!.listen(0, resolve));

    const response = await fetch(`${baseUrl()}/api/crash`);

    expect(response.status).toBe(500);
  });
});
