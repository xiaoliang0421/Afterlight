import { AppError } from "./errors";

type ReadRange = (offset: number, length: number) => Promise<ArrayBuffer>;
// Read only MP4 box headers and the bounded movie metadata, never the complete video in memory.
export async function probeMp4(
  read: ReadRange,
  size: number,
  maxDurationMs = 20000,
): Promise<number> {
  let offset = 0;
  let boxes = 0;
  while (offset + 8 <= size) {
    if (++boxes > 512) break;
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
          if (
            !scale ||
            !Number.isSafeInteger(ms) ||
            ms < 1000 ||
            ms > maxDurationMs
          )
            throw new AppError(
              "invalid_duration",
              `The video must be between 1 and ${maxDurationMs / 1000} seconds.`,
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
// Finished uploads use a separate duration and codec contract from generated clips.
export async function probeUploadedMedia(
  env: Cloudflare.Env,
  key: string,
  expectedBytes: number,
) {
  const head = await env.MEDIA.head(key);
  if (!head || head.size !== expectedBytes || head.size > 64 * 1024 * 1024)
    throw new AppError(
      "invalid_upload",
      "The uploaded file is incomplete or too large.",
      409,
    );
  const read: ReadRange = async (offset, length) => {
    const part = await env.MEDIA.get(key, {
      range: { offset, length },
      onlyIf: { etagMatches: head.etag },
    });
    if (!part || !("body" in part))
      throw new AppError(
        "upload_changed",
        "The uploaded file changed during inspection.",
        409,
      );
    return part.arrayBuffer();
  };
  const duration = await probeMp4(read, head.size, 60000);
  let offset = 0,
    count = 0,
    video = false,
    data = false,
    brand = false;
  const typeAt = (v: DataView, n: number) =>
    String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + n, 4));
  const inspect = (v: DataView, depth = 0) => {
    if (depth > 8)
      throw new AppError("invalid_upload", "Invalid MP4 structure.", 409);
    let pos = 0;
    while (pos + 8 <= v.byteLength) {
      const size = v.getUint32(pos),
        kind = typeAt(v, pos + 4);
      if (size < 8 || pos + size > v.byteLength)
        throw new AppError("invalid_upload", "Invalid MP4 metadata.", 409);
      if (["trak", "mdia", "minf", "stbl"].includes(kind))
        inspect(
          new DataView(v.buffer, v.byteOffset + pos + 8, size - 8),
          depth + 1,
        );
      if (kind === "stsd") {
        if (size < 16)
          throw new AppError(
            "invalid_upload",
            "Missing MP4 codec information.",
            409,
          );
        let entry = pos + 16;
        for (let i = 0; i < v.getUint32(pos + 12); i++) {
          if (entry + 8 > pos + size)
            throw new AppError(
              "invalid_upload",
              "Invalid MP4 codec information.",
              409,
            );
          const length = v.getUint32(entry),
            codec = typeAt(v, entry + 4);
          if (
            length < 8 ||
            entry + length > pos + size ||
            !["avc1", "avc3", "mp4a"].includes(codec)
          )
            throw new AppError(
              "upload_codec",
              "Export an MP4 with H.264 video and AAC audio (or no audio).",
              409,
            );
          if (codec === "avc1" || codec === "avc3") video = true;
          entry += length;
        }
      }
      pos += size;
    }
  };
  while (offset + 8 <= head.size && ++count <= 512) {
    const v = new DataView(
      await read(offset, Math.min(16, head.size - offset)),
    );
    let length = v.getUint32(0),
      header = 8;
    const kind = typeAt(v, 4);
    if (length === 1) {
      if (v.byteLength < 16) break;
      length = Number(v.getBigUint64(8));
      header = 16;
    }
    if (length === 0) length = head.size - offset;
    if (
      !Number.isSafeInteger(length) ||
      length < header ||
      offset + length > head.size
    )
      break;
    if (kind === "ftyp") brand = true;
    if (kind === "mdat" && length > header) data = true;
    if (kind === "moov") {
      if (length > 2 * 1024 * 1024)
        throw new AppError("invalid_upload", "MP4 metadata is too large.", 409);
      inspect(new DataView(await read(offset + header, length - header)));
    }
    offset += length;
  }
  if (!brand || !video || !data || offset !== head.size)
    throw new AppError(
      "invalid_upload",
      "Upload a complete playable MP4 video.",
      409,
    );
  return duration;
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
    redirect: "manual",
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
  // RFC 9110: Range applies only to GET. We expose a strong ETag, but no
  // Last-Modified validator; dates and weak/mismatched tags require a full read.
  let range = request.method === "GET" ? request.headers.get("range") : null;
  const ifRange = request.headers.get("if-range");
  if (ifRange !== null && ifRange !== head.httpEtag) range = null;
  if (range && !/^bytes=/i.test(range)) range = null;
  let start = 0,
    end = head.size - 1;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/i.exec(range);
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
  let object: R2Object | R2ObjectBody = head;
  if (request.method !== "HEAD") {
    let result = await env.MEDIA.get(
      key,
      range
        ? {
            range: { offset: start, length: end - start + 1 },
            onlyIf: { etagMatches: head.etag },
          }
        : undefined,
    );
    // R2 returns metadata without a body when the conditional read loses a
    // replacement race. Restart with a full current object, never mixed bytes.
    if (result && !("body" in result)) {
      range = null;
      result = await env.MEDIA.get(key);
    }
    if (!result) return new Response("Media is unavailable.", { status: 404 });
    object = result;
  }
  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Content-Length": String(range ? end - start + 1 : object.size),
    ETag: object.httpEtag,
    "Cache-Control": publicMedia
      ? "public, no-cache, must-revalidate"
      : "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  if (range)
    headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
  return new Response("body" in object ? object.body : null, {
    status: range ? 206 : 200,
    headers,
  });
}
