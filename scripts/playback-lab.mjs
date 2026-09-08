// Local-only browser acceptance harness. No account, Worker or provider access.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const media = readFileSync(
  new URL("../public/samples/playback.mp4", import.meta.url),
);
const modes = new Set(["normal", "slow", "stall", "unavailable"]);
let mode = "normal";
const server = await createServer({
  configFile: false,
  plugins: [
    react(),
    {
      name: "local-playback-conditions",
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          const url = new URL(req.url, "http://127.0.0.1:5179");
          if (!url.pathname.startsWith("/__playback-lab/")) return next();
          res.setHeader("Cache-Control", "no-store");
          if (url.pathname === "/__playback-lab/mode" && req.method === "GET") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ mode }));
            return;
          }
          if (
            url.pathname === "/__playback-lab/mode" &&
            req.method === "POST"
          ) {
            if (req.headers.origin !== "http://127.0.0.1:5179") {
              res.writeHead(403).end();
              return;
            }
            const requested = url.searchParams.get("value");
            if (!modes.has(requested)) {
              res.writeHead(400).end();
              return;
            }
            mode = requested;
            console.log(`Synthetic media condition: ${mode}`);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ mode }));
            return;
          }
          if (url.pathname === "/__playback-lab/captions.vtt") {
            res.setHeader("Content-Type", "text/vtt");
            res.end(
              "WEBVTT\n\n00:00:00.000 --> 00:00:09.900\nThis is a local playback sample.\nNo generated story is being published.\n",
            );
            return;
          }
          if (url.pathname !== "/__playback-lab/clip.mp4") {
            res.writeHead(404).end();
            return;
          }
          const condition = mode;
          console.log(
            `Synthetic media GET: ${condition}, ${req.headers.range ?? "full"}`,
          );
          if (condition === "unavailable") {
            res.writeHead(503).end();
            return;
          }
          const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
          const start = match ? Number(match[1]) : 0;
          const end = match?.[2]
            ? Math.min(Number(match[2]), media.length - 1)
            : media.length - 1;
          if (!Number.isSafeInteger(start) || start > end) {
            res.writeHead(416).end();
            return;
          }
          res.setHeader("Content-Type", "video/mp4");
          res.setHeader("Accept-Ranges", "bytes");
          res.setHeader("Content-Length", end - start + 1);
          if (match)
            res.setHeader(
              "Content-Range",
              `bytes ${start}-${end}/${media.length}`,
            );
          res.writeHead(match ? 206 : 200);
          if (req.method === "HEAD") {
            res.end();
            return;
          }
          if (condition === "normal") {
            res.end(media.subarray(start, end + 1));
            return;
          }
          if (condition === "stall") {
            // Send a real partial response and keep the socket open. The browser
            // must encounter an actual incomplete media load, not a fake event.
            res.write(media.subarray(start, Math.min(start + 1024, end + 1)));
            return;
          }
          let cursor = start;
          const timer = setInterval(() => {
            const next = Math.min(cursor + 1024, end + 1);
            res.write(media.subarray(cursor, next));
            cursor = next;
            if (cursor > end) {
              clearInterval(timer);
              res.end();
            }
          }, 250);
          res.on("close", () => clearInterval(timer));
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5179, strictPort: true },
});
await server.listen();
console.log(
  "Local synthetic playback lab: http://127.0.0.1:5179/tests/browser/playback-lab.html",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
