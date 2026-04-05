import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";

const MIME_TYPES = new Map([
  [".bin", "application/octet-stream"],
  [".cube", "text/plain; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".hdr", "application/octet-stream"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".ktx", "application/octet-stream"],
  [".ktx2", "application/octet-stream"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"]
]);

function getMimeType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

async function resolveFile(rootDir, requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const fullPath = path.resolve(rootDir, relativePath);

  if (!fullPath.startsWith(rootDir)) {
    return null;
  }

  try {
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      const nestedIndex = path.join(fullPath, "index.html");
      await fs.access(nestedIndex);
      return nestedIndex;
    }
    return fullPath;
  } catch {
    return null;
  }
}

export function startStaticServer({ rootDir, host = "127.0.0.1", port = 4173, quiet = false }) {
  const normalizedRoot = path.resolve(rootDir);
  const server = http.createServer(async (req, res) => {
    try {
      const filePath = await resolveFile(normalizedRoot, req.url ?? "/");

      if (!filePath) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      const body = await fs.readFile(filePath);
      res.writeHead(200, {
        "cache-control": "no-cache",
        "content-type": getMimeType(filePath)
      });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Server error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      const url = `http://${host}:${actualPort}`;
      if (!quiet) {
        console.log(`Serving ${normalizedRoot} at ${url}`);
      }
      resolve({
        url,
        async close() {
          await new Promise((done, fail) => server.close((error) => (error ? fail(error) : done())));
        }
      });
    });
  });
}
