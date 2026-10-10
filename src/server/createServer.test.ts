import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import type { Server } from "node:http";
import { createServer, HttpError } from "./createServer.js";

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
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

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
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const response = await fetch(`${baseUrl()}/styles.css`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/css");
  });

  it("returns 404 for a missing static file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const response = await fetch(`${baseUrl()}/does-not-exist.html`);

    expect(response.status).toBe(404);
  });

  it("blocks a percent-encoded path-traversal attempt outside the static directory", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    // Percent-encoded so it survives to the server undecoded, the way a
    // crafted request (not a normal browser navigation, which a URL parser
    // would already have normalized) would reach it.
    const response = await fetch(`${baseUrl()}/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd`);

    expect([403, 404]).toContain(response.status);
  });

  it("returns 400 for a malformed percent-encoded path instead of hanging or crashing", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

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
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

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
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const response = await fetch(`${baseUrl()}/api/broken`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("nope");
  });

  it("routes by HTTP method and hands the handler the request, so it can check headers", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({
      apiRoutes: {
        "POST /api/echo": (_url, req) => ({ method: req.method, header: req.headers["x-requested-with"] ?? null }),
      },
      staticDir: tempDir,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const response = await fetch(`${baseUrl()}/api/echo`, { method: "POST", headers: { "X-Requested-With": "tester" } });

    expect(await response.json()).toEqual({ method: "POST", header: "tester" });
    // The same path with a different method is not that route.
    expect((await fetch(`${baseUrl()}/api/echo`)).status).toBe(404);
  });

  it("uses the status carried by an HttpError and keeps its message", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({
      apiRoutes: {
        "GET /api/forbidden": () => {
          throw new HttpError(403, "not allowed");
        },
      },
      staticDir: tempDir,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const response = await fetch(`${baseUrl()}/api/forbidden`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not allowed" });
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
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const response = await fetch(`${baseUrl()}/api/crash`);

    expect(response.status).toBe(500);
  });

  it("returns 400 instead of crashing on an unparseable absolute-form request target", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({ apiRoutes: {}, staticDir: tempDir });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server!.address() as AddressInfo).port;

    const response = await new Promise<string>((resolvePromise, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(
          "GET http://evil.example:99999/api/status HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
        );
      });
      let data = "";
      socket.on("data", (chunk) => {
        data += chunk.toString();
      });
      socket.on("end", () => resolvePromise(data));
      socket.on("error", reject);
      socket.setTimeout(2000, () => reject(new Error("socket timed out waiting for a response")));
    });

    expect(response).toMatch(/^HTTP\/1\.1 400/);
  });

  it("does not crash when a route handler's response fails to serialize after headers are already sent", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tarkov-server-test-"));
    server = createServer({
      apiRoutes: { "GET /api/unserializable": () => ({ value: 10n }) },
      staticDir: tempDir,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    // The 200 header is already flushed before JSON.stringify throws on the
    // BigInt, so a "clean" response isn't possible here — the point of this
    // test is that the process survives and something comes back, not that
    // the response is well-formed.
    await expect(fetch(`${baseUrl()}/api/unserializable`)).resolves.toBeDefined();
  });
});
