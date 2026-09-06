import { AppError } from "./errors";

type ReadRange = (offset: number, length: number) => Promise<ArrayBuffer>;
// Read only MP4 box headers and the bounded movie metadata, never the complete video in memory.
export async function probeMp4(read: ReadRange, size: number): Promise<number> {
  let offset = 0;
  while (offset + 8 <= size) {
    const head = new DataView(await read(offset, Math.min(16, size - offset)));
    if (head.byteLength < 8) break;
    let length = head.getUint32(0),
      headerSize = 8;
    const type = String.fromCharCode(
      ...new Uint8Array(head.buffer, head.byteOffset + 4, 4),
    );
    if (length === 1) {
      if (head.byteLength < 16) break;
      length = Number(head.getBigUint64(8));
      headerSize = 16;
    }
    if (length === 0) length = size - offset;
    if (
      !Number.isSafeInteger(length) ||
      length < headerSize ||
      offset + length > size
    )
      throw new AppError(
        "invalid_media",
        "The video file has invalid metadata.",
        409,
      );
    if (type === "moov") {
      if (length > 2 * 1024 * 1024)
        throw new AppError(
          "media_metadata_large",
          "This video requires a separate media processing step.",
          409,
        );
      const box = new DataView(
        await read(offset + headerSize, length - headerSize),
      );
      let inner = 0;
      while (inner + 8 <= box.byteLength) {
        const innerSize = box.getUint32(inner),
          innerType = String.fromCharCode(
            ...new Uint8Array(box.buffer, box.byteOffset + inner + 4, 4),
          );
        if (innerSize < 8 || inner + innerSize > box.byteLength) break;
        if (innerType === "mvhd") {
          const pos = inner + 8,
            v = box.getUint8(pos);
          if ((v !== 0 && v !== 1) || innerSize < (v ? 40 : 28)) break;
          const scale = box.getUint32(pos + (v ? 20 : 12));
          const duration = v
            ? Number(box.getBigUint64(pos + 24))
            : box.getUint32(pos + 16);
          const ms = Math.round((duration / scale) * 1000);
          if (!scale || !Number.isSafeInteger(ms) || ms <= 0 || ms > 20000)
            throw new AppError(
              "invalid_duration",
              "The generated clip has an unexpected duration.",
              409,
            );
          return ms;
        }
        inner += innerSize;
      }
    }
    offset += length;
  }
  throw new AppError(
    "invalid_media",
    "The generated video needs media inspection before publication.",
    409,
  );
}
export async function probeStoredMedia(env: Cloudflare.Env, key: string) {
  const head = await env.MEDIA.head(key);
  if (!head || head.size > 64 * 1024 * 1024)
    throw new AppError(
      "invalid_media",
      "The video file is missing or too large.",
      409,
    );
  return probeMp4(async (offset, length) => {
    const part = await env.MEDIA.get(key, { range: { offset, length } });
    if (!part) throw new Error("Media disappeared during inspection.");
    return part.arrayBuffer();
  }, head.size);
}
export function trustedFalUrl(raw: string, queue = false): URL {
  const url = new URL(raw);
  const hosts = queue ? ["queue.fal.run"] : ["fal.media", "fal.ai", "fal.run"];
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !hosts.some(
      (h) => url.hostname === h || (!queue && url.hostname.endsWith(`.${h}`)),
    )
  )
    throw new AppError(
      "untrusted_provider_url",
      "The provider returned an unexpected media address.",
      503,
    );
  return url;
}
export async function storeProviderMedia(
  env: Cloudflare.Env,
  rawUrl: string,
  key: string,
) {
  if (await env.MEDIA.head(key)) return;
  const response = await fetch(trustedFalUrl(rawUrl), {
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  const length = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    !response.body ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > 64 * 1024 * 1024
  )
    throw new AppError(
      "media_transfer_failed",
      "The generated video could not be safely archived. Generation will not be repeated.",
      503,
    );
  await env.MEDIA.put(key, response.body, {
    httpMetadata: { contentType: "video/mp4" },
    customMetadata: { source: "fal", archivedAt: String(Date.now()) },
  });
}
export async function serveR2(
  env: Cloudflare.Env,
  key: string,
  request: Request,
  contentType: string,
  publicMedia = false,
): Promise<Response> {
  const head = await env.MEDIA.head(key);
  if (!head) return new Response("Media is unavailable.", { status: 404 });
  const range = request.headers.get("range");
  let start = 0,
    end = head.size - 1;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${head.size}` },
      });
    if (!m[1]) start = Math.max(0, head.size - Number(m[2]));
    else {
      start = Number(m[1]);
      if (m[2]) end = Math.min(end, Number(m[2]));
    }
    if (!Number.isSafeInteger(start) || start > end || start >= head.size)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${head.size}` },
      });
  }
  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
    ETag: head.httpEtag,
    "Cache-Control": publicMedia ? "public, max-age=60" : "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${head.size}`);
  if (request.method === "HEAD")
    return new Response(null, { status: range ? 206 : 200, headers });
  const object = await env.MEDIA.get(
    key,
    range ? { range: { offset: start, length: end - start + 1 } } : undefined,
  );
  if (!object) return new Response("Media not found", { status: 404 });
  return new Response(object.body, {
    status: range ? 206 : 200,
    headers,
  });
}
