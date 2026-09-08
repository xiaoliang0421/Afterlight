import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("R2 upload inspection checks real MP4 structure, size, codec and the 60-second contract", async (t) => {
  const bundle = await build({
    stdin: {
      contents: `import {probeUploadedMedia} from './worker/media.ts';
    export default {async fetch(request,env){try{return Response.json({duration:await probeUploadedMedia(env,'clip.mp4',Number(new URL(request.url).searchParams.get('bytes')))})}catch(e){return Response.json({error:e.code},{status:e.status??500})}}};`,
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
  const file = readFileSync("public/samples/playback.mp4");
  const check = async (data: Buffer, bytes = data.length) => {
    await bucket.put("clip.mp4", data);
    return runtime.dispatchFetch(`https://test.invalid/probe?bytes=${bytes}`);
  };
  const valid = await check(file);
  assert.equal(valid.status, 200);
  const original = (await valid.json()) as any;
  assert.ok(original.duration >= 1000 && original.duration <= 60000);
  assert.equal((await check(file, file.length + 1)).status, 409);
  assert.equal((await check(file.subarray(0, file.length - 100))).status, 409);
  const codec = Buffer.from(file),
    codecOffset = codec.indexOf("stsd") + 16;
  assert.ok(codecOffset > 0);
  assert.equal(codec.toString("ascii", codecOffset, codecOffset + 4), "avc1");
  codec.write("hvc1", codecOffset, "ascii");
  const badCodec = await check(codec);
  assert.equal(badCodec.status, 409);
  assert.equal(((await badCodec.json()) as any).error, "upload_codec");
  // Change only the movie duration in a copy to exercise metadata bounds; this
  // synthetic fixture is not evidence of thirty seconds of actual decoded video.
  const longer = Buffer.from(file),
    mvhd = longer.indexOf("mvhd"),
    version = longer[mvhd + 4];
  assert.equal(version, 0);
  const scale = longer.readUInt32BE(mvhd + 16);
  longer.writeUInt32BE(scale * 30, mvhd + 20);
  const thirty = await check(longer);
  assert.equal(thirty.status, 200);
  assert.equal(((await thirty.json()) as any).duration, 30000);
  longer.writeUInt32BE(scale * 61, mvhd + 20);
  assert.equal((await check(longer)).status, 409);
  const noData = Buffer.from(file),
    mdat = noData.indexOf("mdat");
  assert.ok(mdat > 0);
  noData.write("free", mdat, "ascii");
  assert.equal((await check(noData)).status, 409);
});
