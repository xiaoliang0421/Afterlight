import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const state = await mkdtemp(path.join(tmpdir(), "afterlight-integration-"));
const cli = path.resolve("node_modules/wrangler/bin/wrangler.js");
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_WRITE_LOGS: "false",
  // Fixture tests should neither require nor alter the operator's CLI profile.
  XDG_CONFIG_HOME: path.join(state, "config"),
};
const browser = process.argv.includes("--browser");
const port = browser ? "8788" : "8790";
const origin = browser ? "http://127.0.0.1:5178" : "http://127.0.0.1:8790";
let server, frontend;
try {
  for (const args of [
    ["d1", "migrations", "apply", "DB", "--local"],
    ["d1", "execute", "DB", "--local", "--file", "fixtures/seed.sql"],
    ["d1", "execute", "DB", "--local", "--file", "fixtures/production.sql"],
    [
      "d1",
      "execute",
      "DB",
      "--local",
      "--file",
      "tests/fixtures/account-deletion.sql",
    ],
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
      port,
      "--inspector-port",
      "0",
      "--persist-to",
      state,
      "--var",
      `PUBLIC_ORIGIN:${origin}`,
      // Synthetic credentials exercise the real OAuth start route and local D1
      // schema without signing in to Google or using any operator credentials.
      "--var",
      "BETTER_AUTH_SECRET:integration-only-auth-secret-never-deploy",
      "--var",
      "GOOGLE_CLIENT_ID:integration-only.apps.googleusercontent.com",
      "--var",
      "GOOGLE_CLIENT_SECRET:integration-only-google-secret",
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
      ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
      if (ready) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error("Local test Worker did not start. " + logs);
  if (browser) {
    frontend = spawn(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    frontend.stdout.on("data", (d) => {
      logs = (logs + d).slice(-20000);
    });
    frontend.stderr.on("data", (d) => {
      logs = (logs + d).slice(-20000);
    });
    let frontendReady = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        frontendReady = (await fetch(`${origin}/api/health`)).ok;
        if (frontendReady) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!frontendReady)
      throw new Error("Browser test frontend did not start. " + logs);
  }
  const child = spawn(
    process.execPath,
    browser
      ? ["node_modules/@playwright/test/cli.js", "test"]
      : ["--import", "tsx", "--test", "tests/integration/api.test.ts"],
    { env: { ...env, AFTERLIGHT_TEST_ORIGIN: origin }, stdio: "inherit" },
  );
  const code = await new Promise((resolve) => child.on("exit", resolve));
  if (code !== 0) process.stderr.write(logs);
  process.exitCode = typeof code === "number" ? code : 1;
} finally {
  if (frontend && frontend.exitCode === null && frontend.signalCode === null) {
    const stopped = new Promise((resolve) => frontend.once("exit", resolve));
    frontend.kill("SIGTERM");
    await stopped;
  }
  if (server && server.exitCode === null && server.signalCode === null) {
    // The Worker may already have exited after a startup failure. Register the
    // listener before termination so cleanup cannot hide the original error.
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await stopped;
  }
  await rm(state, { recursive: true, force: true });
}
