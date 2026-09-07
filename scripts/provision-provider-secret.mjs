// Provision only this app's staging Worker; secrets travel through a child stdin pipe.
import { spawn } from "node:child_process";
import path from "node:path";
const name = process.argv[2];
if (
  !["FAL_KEY", "DIRECTOR_API_KEY", "PADDLE_API_KEY"].includes(name) ||
  !process.env[name]
)
  throw new Error(
    "Use the Keychain helper with an approved provider secret name.",
  );
const child = spawn(
  process.execPath,
  [
    path.resolve("node_modules/wrangler/bin/wrangler.js"),
    "secret",
    "put",
    name,
    "--env",
    "staging",
  ],
  {
    env: {
      ...process.env,
      WRANGLER_WRITE_LOGS: "false",
      WRANGLER_SEND_METRICS: "false",
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
);
// Avoid relaying provider secrets, auth diagnostics or temporary URLs from downstream tools.
child.stdout.resume();
child.stderr.resume();
child.stdin.on("error", () => {});
child.stdin.end(process.env[name] + "\n");
const code = await new Promise((resolve) => child.on("exit", resolve));
if (code !== 0)
  throw new Error(
    `Staging secret provisioning failed (${code}); values and downstream output withheld.`,
  );
console.log(
  `${name} provisioned on afterlight-staging. Generation/payment switches remain unchanged.`,
);
