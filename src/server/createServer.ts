import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export type ApiHandler = (url: URL) => Promise<unknown> | unknown;

export interface ServerOptions {
  apiRoutes: Record<string, ApiHandler>;
  staticDir: string;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function createServer(options: ServerOptions): Server {
  return createHttpServer((req, res) => {
    void handleRequest(req, res, options);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, options: ServerOptions): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const routeKey = `${req.method} ${url.pathname}`;
  const handler = options.apiRoutes[routeKey];

  if (handler) {
    try {
      const body = await handler(url);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      const message = error instanceof Error ? error.message : "Internal error";
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: message }));
    }
    return;
  }

  await serveStatic(options.staticDir, url.pathname, res);
}

async function serveStatic(staticDir: string, pathname: string, res: ServerResponse): Promise<void> {
  const decodedPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const resolvedStaticDir = resolve(staticDir);
  const filePath = resolve(resolvedStaticDir, `.${decodedPath}`);

  if (filePath !== resolvedStaticDir && !filePath.startsWith(resolvedStaticDir + sep)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}
