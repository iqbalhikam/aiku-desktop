import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { loadOrCreateConfig } from "../config/loader.js";
import { AiKuRpcWorker } from "../rpc/worker.js";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

// Izinkan hingga 25 MB untuk unggahan sampel audio WAV Voice Clone lokal (127.0.0.1 only)
const MAX_BODY_BYTES = 25 * 1024 * 1024;

function openDesktopWindow(url: string): void {
  if (process.platform === "win32") {
    // Buka di Edge App Mode kompak menyerupai Dynamic Island di bagian atas layar (0 download)
    const child = spawn(
      "cmd",
      ["/c", "start", "", "msedge", `--app=${url}`, "--window-size=740,520", "--window-position=380,24"],
      {
        detached: true,
        stdio: "ignore",
      }
    );
    child.unref();
  }
}

async function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overflowed = false;

    req.on("data", (chunk: Buffer) => {
      if (overflowed) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        overflowed = true;
        chunks.length = 0;
        req.resume();
        reject(new Error("Ukuran sampel audio melebihi batas maksimal 25 MB."));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!overflowed) {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });

    req.on("error", reject);
  });
}

async function startDesktopServer(): Promise<void> {
  const noOpen = process.argv.includes("--no-open");
  const { config, configPath } = await loadOrCreateConfig();
  const worker = new AiKuRpcWorker(config, configPath);
  worker.startMemoryHubServer();
  let wallpaperChild: ReturnType<typeof spawn> | null = null;
  let serverPort = 0;
  const sessionToken = crypto.randomBytes(24).toString("hex");
  const uiDir = path.resolve(process.cwd(), "desktop", "ui");

  const server = http.createServer((req, res) => {
    void (async () => {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");

      // Direct Unified Memory Graph endpoint untuk wallpaper.html
      if (req.method === "GET" && reqUrl.pathname === "/api/memory-graph") {
        const rpcRes = await worker.handleRequest(
          JSON.stringify({ id: "graph", method: "getMemoryGraph", params: {} })
        );
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(rpcRes.ok ? rpcRes.result : { nodes: [], edges: [] }));
        return;
      }

      // Toggle Native Windows WorkerW Live Wallpaper (bekerja di mode npm run ui tanpa Rust!)
      if (req.method === "POST" && reqUrl.pathname === "/api/wallpaper-toggle") {
        const providedToken = req.headers["x-aiku-token"];
        if (providedToken !== sessionToken) {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Token sesi tidak valid." }));
          return;
        }
        try {
          const rawBody = await readRequestBody(req);
          const body = JSON.parse(rawBody || "{}") as { enabled?: boolean };
          const wantEnabled = Boolean(body.enabled);
          if (!wantEnabled) {
            if (wallpaperChild && !wallpaperChild.killed) {
              wallpaperChild.kill();
            }
            wallpaperChild = null;
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: true, enabled: false }));
            return;
          }

          if (!wallpaperChild || wallpaperChild.killed) {
            const psScript = path.resolve(process.cwd(), "desktop", "windows-island", "wallpaper.ps1");
            const wallUrl = `http://127.0.0.1:${serverPort}/wallpaper.html`;
            wallpaperChild = spawn(
              "powershell.exe",
              ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", psScript, "-Url", wallUrl],
              { stdio: "ignore", windowsHide: true }
            );
            wallpaperChild.on("exit", () => {
              wallpaperChild = null;
            });
          }

          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, enabled: true }));
        } catch (err: unknown) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      // API RPC Stream endpoint (NDJSON real-time token streaming untuk respon AI instan!)
      if (req.method === "POST" && reqUrl.pathname === "/api/rpc-stream") {
        const providedToken = req.headers["x-aiku-token"];
        if (providedToken !== sessionToken) {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Token sesi tidak valid." }));
          return;
        }

        try {
          const rawBody = await readRequestBody(req);
          res.writeHead(200, {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
          });
          const response = await worker.handleRequest(
            rawBody,
            (_id, chunk) => {
              res.write(`${JSON.stringify({ stream: chunk })}\n`);
            },
            (_id, wavBase64) => {
              res.write(`${JSON.stringify({ audio: wavBase64 })}\n`);
            }
          );
          res.end(`${JSON.stringify(response)}\n`);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          if (!res.headersSent) {
            res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          }
          res.end(`${JSON.stringify({ id: null, ok: false, error: message })}\n`);
        }
        return;
      }

      // API RPC endpoint (dilindungi token sesi acak untuk mencegah CSRF lokal)
      if (req.method === "POST" && reqUrl.pathname === "/api/rpc") {
        const providedToken = req.headers["x-aiku-token"];
        if (providedToken !== sessionToken) {
          res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, error: "Token sesi tidak valid." }));
          return;
        }

        try {
          const rawBody = await readRequestBody(req);
          const response = await worker.handleRequest(rawBody);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(response));
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ id: null, ok: false, error: message }));
        }
        return;
      }

      // Layani file statis UI (index.html, styles.css, app.js)
      if (req.method === "GET") {
        const requestedFile = reqUrl.pathname === "/" ? "index.html" : reqUrl.pathname.replace(/^\/+/, "");
        if (requestedFile.includes("..") || requestedFile.includes("/") || requestedFile.includes("\\")) {
          res.writeHead(400);
          res.end("Bad request");
          return;
        }

        const filePath = path.join(uiDir, requestedFile);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = CONTENT_TYPES[ext];
        if (!contentType) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        try {
          let content = await fs.readFile(filePath, "utf8");
          if (requestedFile === "index.html") {
            // Sisipkan token sesi secara aman melalui meta tag
            const tokenMeta = `<meta name="aiku-session-token" content="${sessionToken}" />`;
            content = content.replace("</head>", `  ${tokenMeta}\n  </head>`);
          }
          res.writeHead(200, {
            "Content-Type": contentType,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end("Not found");
        }
        return;
      }

      res.writeHead(405);
      res.end("Method not allowed");
    })();
  });

  // Bind ketat hanya ke 127.0.0.1 (tidak dapat diakses dari jaringan luar)
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Gagal mendapatkan port lokal server UI.");
  }

  serverPort = address.port;
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`\n[aiKu Desktop UI] Berjalan lokal di: ${url}`);
  console.log(`[aiKu Sandbox]    Terkunci pada: ${config.allowedDirectories.join(", ")}`);
  console.log("[aiKu Security]   127.0.0.1 only | Session Token aktif | Dry-Run default");
  console.log("Tekan Ctrl+C untuk menghentikan aplikasi.\n");

  if (!noOpen) {
    openDesktopWindow(url);
  }
}

startDesktopServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[FATAL] ${message}`);
  process.exitCode = 1;
});
