import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const state = await mkdtemp(path.join(tmpdir(), "afterlight-integration-"));
const cli = path.resolve("node_modules/wrangler/bin/wrangler.js");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
const origin = "http://127.0.0.1:8790";
let server;
try {
  for (const args of [
    ["d1", "migrations", "apply", "DB", "--local"],
    ["d1", "execute", "DB", "--local", "--file", "fixtures/seed.sql"],
    [
      "d1",
      "execute",
      "DB",
      "--local",
      "--file",
      "tests/fixtures/account-export.sql",
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      [cli, ...args, "--persist-to", state],
      { env, encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  }
  server = spawn(
    process.execPath,
    [
      cli,
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      "8790",
      "--inspector-port",
      "0",
      "--persist-to",
      state,
      "--var",
      `PUBLIC_ORIGIN:${origin}`,
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  server.stdout.on("data", (d) => {
    logs = (logs + d).slice(-20000);
  });
  server.stderr.on("data", (d) => {
    logs = (logs + d).slice(-20000);
  });
  const deadline = Date.now() + 45000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      ready = (await fetch(`${origin}/api/health`)).ok;
      if (ready) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error("Local test Worker did not start. " + logs);
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--test", "tests/integration/api.test.ts"],
    { env: { ...env, AFTERLIGHT_TEST_ORIGIN: origin }, stdio: "inherit" },
  );
  const code = await new Promise((resolve) => child.on("exit", resolve));
  if (code !== 0) process.stderr.write(logs);
  process.exitCode = typeof code === "number" ? code : 1;
} finally {
  if (server) {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
  await rm(state, { recursive: true, force: true });
}
