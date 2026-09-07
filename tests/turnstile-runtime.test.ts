import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("Workers verifies Turnstile using native fetch and never follows a redirect carrying the token", async () => {
  // A Node fetch mock accepts redirect:"error", but workerd rejects it before
  // making any request. Exercise the actual adapter inside the deployed runtime.
  const bundle = await build({
    stdin: {
      contents: `import { verifyHuman } from './worker/turnstile.ts';
        export default { async fetch(request) {
          try {
            await verifyHuman({ PUBLIC_ORIGIN:'https://story.example.com',
              ENVIRONMENT:'staging', PROVIDER_MODE:'disabled',
              TURNSTILE_SITE_KEY:'synthetic-public',
              TURNSTILE_SECRET_KEY:'synthetic-secret' }, request, 'create_story');
            return Response.json({verified:true});
          } catch(error) {
            return Response.json({code:error.code}, {status:error.status ?? 500});
          }
        }};`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    conditions: ["workerd", "worker", "browser"],
    external: ["cloudflare:*", "node:*"],
  });
  let mode = "success";
  const requests: { url: string; body: URLSearchParams }[] = [];
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-06",
      compatibilityFlags: ["nodejs_compat"],
      script: bundle.outputFiles[0].text,
      outboundService: async (request) => {
        assert.equal(request.method, "POST");
        assert.match(
          request.headers.get("content-type") ?? "",
          /^application\/x-www-form-urlencoded/,
        );
        requests.push({
          url: request.url,
          body: new URLSearchParams(await request.text()),
        });
        if (mode === "redirect")
          return new Response(null, {
            status: 307,
            headers: { Location: "https://unrelated.example/collect" },
          });
        if (mode === "outage")
          return new Response("Unavailable", { status: 503 });
        return Response.json({
          success: true,
          hostname:
            mode === "wrong-host" ? "other.example.com" : "story.example.com",
          action: "create_story",
        });
      },
    }),
  );
  try {
    for (const [current, expected] of [
      ["success", 200],
      ["redirect", 503],
      ["outage", 503],
      ["wrong-host", 403],
    ] as const) {
      mode = current;
      const response = await runtime.dispatchFetch(
        "https://story.example.com/api/stories",
        {
          method: "POST",
          headers: { "X-Turnstile-Token": "synthetic-single-use-token" },
        },
      );
      assert.equal(
        response.status,
        expected,
        `${current}: ${await response.text()}`,
      );
    }
    assert.equal(requests.length, 4);
    for (const request of requests) {
      assert.equal(
        request.url,
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      );
      assert.equal(request.body.get("secret"), "synthetic-secret");
      assert.equal(request.body.get("response"), "synthetic-single-use-token");
    }
  } finally {
    await runtime.dispose();
  }
});
