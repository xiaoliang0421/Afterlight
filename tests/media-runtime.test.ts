import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("Workers serves resumable media from a consistent R2 object", async (t) => {
  const bundle = await build({
    stdin: {
      contents: `import { serveR2 } from './worker/media.ts';
        export default { async fetch(request, env) {
          let changed = false;
          const media = {
            head: key => env.MEDIA.head(key),
            get: async (key, options) => {
              const change = request.headers.get('X-Test-Change');
              if (change && !changed) {
                changed = true;
                if (change === 'delete') await env.MEDIA.delete(key);
                else await env.MEDIA.put(key, 'replacement-content');
              }
              return env.MEDIA.get(key, options);
            }
          };
          return serveR2({ MEDIA: media }, 'clip.mp4', request, 'video/mp4',
            !request.headers.has('X-Test-Private'));
        }};`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    conditions: ["workerd", "worker", "browser"],
  });
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-06",
      script: bundle.outputFiles[0].text,
      r2Buckets: ["MEDIA"],
    }),
  );
  t.after(() => runtime.dispose());
  const bucket = await runtime.getR2Bucket("MEDIA");
  const original = "0123456789abcdef";
  const reset = () => bucket.put("clip.mp4", original);
  const get = (headers: Record<string, string> = {}, method = "GET") =>
    runtime.dispatchFetch("https://story.example.com/video", {
      method,
      headers,
    });

  await t.test(
    "full reads and HEAD retain media headers; HEAD ignores Range",
    async () => {
      const object = await reset();
      for (const method of ["GET", "HEAD"]) {
        const response = await get(
          method === "HEAD" ? { Range: "bytes=0-3" } : {},
          method,
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("Content-Length"), "16");
        assert.equal(response.headers.get("Content-Range"), null);
        assert.equal(response.headers.get("ETag"), object.httpEtag);
        assert.equal(response.headers.get("Content-Type"), "video/mp4");
        assert.equal(response.headers.get("Accept-Ranges"), "bytes");
        assert.equal(
          response.headers.get("Cache-Control"),
          "public, no-cache, must-revalidate",
        );
        assert.equal(
          response.headers.get("Cross-Origin-Resource-Policy"),
          "same-origin",
        );
        assert.equal(await response.text(), method === "HEAD" ? "" : original);
      }
      const privateResponse = await get({ "X-Test-Private": "1" });
      assert.equal(
        privateResponse.headers.get("Cache-Control"),
        "private, no-store",
      );
      await privateResponse.body?.cancel();
    },
  );

  await t.test(
    "matching strong validators support bounded, open and suffix ranges",
    async () => {
      const object = await reset();
      for (const [range, start, end] of [
        ["bytes=0-3", 0, 3],
        ["BYTES=0-3", 0, 3],
        ["bytes=4-", 4, 15],
        ["bytes=-4", 12, 15],
        ["bytes=14-999999999999999999999", 14, 15],
        ["bytes=-999999999999999999999", 0, 15],
      ] as const) {
        const response = await get({
          Range: range,
          "If-Range": object.httpEtag,
        });
        assert.equal(response.status, 206, range);
        assert.equal(
          response.headers.get("Content-Range"),
          `bytes ${start}-${end}/16`,
        );
        assert.equal(
          response.headers.get("Content-Length"),
          String(end - start + 1),
        );
        assert.equal(response.headers.get("ETag"), object.httpEtag);
        assert.equal(await response.text(), original.slice(start, end + 1));
      }
    },
  );

  await t.test(
    "stale, weak and unsupported date validators restart with the complete file",
    async () => {
      const object = await reset();
      for (const validator of [
        '"previous-object"',
        `W/${object.httpEtag}`,
        object.etag,
        "Tue, 08 Sep 2026 01:00:00 GMT",
        "invalid",
      ]) {
        for (const range of ["bytes=0-3", "bytes=999-"]) {
          const response = await get({ Range: range, "If-Range": validator });
          assert.equal(response.status, 200, `${validator}: ${range}`);
          assert.equal(response.headers.get("Content-Range"), null);
          assert.equal(response.headers.get("Content-Length"), "16");
          assert.equal(await response.text(), original);
        }
      }
      const unsupported = await get({ Range: "frames=0-3" });
      assert.equal(unsupported.status, 200);
      assert.equal(await unsupported.text(), original);
    },
  );

  await t.test(
    "unsatisfiable ranges return 416, including an empty object",
    async () => {
      await reset();
      for (const range of [
        "bytes=",
        "bytes=0-1,4-5",
        "bytes=16-",
        "bytes=5-3",
        "bytes=-0",
      ]) {
        const response = await get({ Range: range });
        assert.equal(response.status, 416, range);
        assert.equal(response.headers.get("Content-Range"), "bytes */16");
        assert.equal(await response.text(), "");
      }
      await bucket.put("clip.mp4", "");
      const full = await get();
      assert.equal(full.status, 200);
      assert.equal(await full.text(), "");
      const partial = await get({ Range: "bytes=0-" });
      assert.equal(partial.status, 416);
      assert.equal(partial.headers.get("Content-Range"), "bytes */0");
    },
  );

  await t.test(
    "replacement between HEAD and GET returns one complete current version",
    async () => {
      for (const ranged of ["none", "plain", "conditional"]) {
        const object = await reset();
        const response = await get({
          "X-Test-Change": "replace",
          ...(ranged !== "none"
            ? {
                Range: "bytes=0-3",
                ...(ranged === "conditional"
                  ? { "If-Range": object.httpEtag }
                  : {}),
              }
            : {}),
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("Content-Range"), null);
        assert.equal(response.headers.get("Content-Length"), "19");
        assert.notEqual(response.headers.get("ETag"), object.httpEtag);
        assert.equal(await response.text(), "replacement-content");
      }
    },
  );

  await t.test(
    "deletion between HEAD and GET returns unavailable without partial bytes",
    async () => {
      await reset();
      const response = await get({
        Range: "bytes=0-3",
        "X-Test-Change": "delete",
      });
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("Content-Range"), null);
      await response.body?.cancel();
    },
  );
});
