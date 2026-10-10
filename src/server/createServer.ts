import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

/**
 * A route handler. It gets the parsed URL and the raw request (so a
 * state-changing route can check headers); handlers that don't need the
 * request can simply ignore the second argument.
 */
export type ApiHandler = (url: URL, req: IncomingMessage) => Promise<unknown> | unknown;

/** Throw from a handler to answer with a specific HTTP status and message. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

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
    handleRequest(req, res, options).catch(() => {
      // Last-resort safety net: nothing inside handleRequest is expected to
      // reach here (every known failure mode below has its own guard), but
      // an uncaught rejection here would otherwise crash the whole process
      // (see this file's fix history for two ways that used to happen).
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal server error");
      } else {
        res.destroy();
      }
    });
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, options: ServerOptions): Promise<void> {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    // A syntactically-invalid request target (e.g. an absolute-form target
    // with an out-of-range port) reaches here as a client-side mistake, not
    // a server error.
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad request");
    return;
  }

  const routeKey = `${req.method} ${url.pathname}`;
  const handler = options.apiRoutes[routeKey];

  if (handler) {
    try {
      const body = await handler(url, req);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    } catch (error) {
      if (res.headersSent) {
        // The 200 status was already queued before something failed (e.g.
        // JSON.stringify choking on an unserializable value) — we can't
        // send a different status now, so just end the response rather
        // than calling writeHead again and crashing on
        // ERR_HTTP_HEADERS_SENT. Note: res.destroy() here would discard
        // the still-unflushed header block and the client would see the
        // connection drop with zero bytes rather than a response; res.end()
        // flushes the pending headers and closes out the body cleanly.
        res.end();
        return;
      }
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
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch (error) {
    if (error instanceof URIError) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad request");
      return;
    }
    throw error;
  }
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
