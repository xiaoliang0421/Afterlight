import type { ExportManifest, ExportPage } from "../shared/account-export";

type ExportCall = <T>(
  path: string,
  body: unknown,
  signal: AbortSignal,
) => Promise<T>;

export async function collectAccountExport(
  call: ExportCall,
  signal: AbortSignal,
  progress: (section: string, count: number) => void,
  maxBytes = 16 * 1024 * 1024,
) {
  const manifest = await call<ExportManifest>("/account/export", {}, signal);
  signal.throwIfAborted();
  // Bound browser memory and only offer a file once every section succeeds.
  const parts: BlobPart[] = [];
  let bytes = 0,
    count = 0;
  const append = (text: string) => {
    const chunk = new TextEncoder().encode(text);
    bytes += chunk.byteLength;
    if (bytes > maxBytes)
      throw new Error(
        "Your records exceed the browser download limit. Contact support for a larger export; no partial file was downloaded.",
      );
    parts.push(chunk);
  };
  append(JSON.stringify(manifest).slice(0, -1) + ',"records":{');
  for (const [index, section] of manifest.sections.entries()) {
    signal.throwIfAborted();
    append((index ? "," : "") + JSON.stringify(section.name) + ":[");
    let after = 0,
      first = true;
    do {
      signal.throwIfAborted();
      const page = await call<ExportPage>(
        "/account/export/page",
        {
          accountId: manifest.accountId,
          section: section.name,
          after,
          through: section.through,
        },
        signal,
      );
      signal.throwIfAborted();
      if (
        page.accountId !== manifest.accountId ||
        page.section !== section.name ||
        (page.next !== null &&
          (!Number.isSafeInteger(page.next) ||
            page.next <= after ||
            page.next > section.through))
      )
        throw new Error(
          "The export changed unexpectedly. Please start a new download.",
        );
      for (const row of page.rows) {
        append((first ? "" : ",") + JSON.stringify(row));
        first = false;
      }
      count += page.rows.length;
      progress(section.name, count);
      if (page.next === null) break;
      after = page.next;
    } while (true);
    append("]");
  }
  append('},"completedAt":' + JSON.stringify(new Date().toISOString()) + "}");
  signal.throwIfAborted();
  return new Blob(parts, { type: "application/json;charset=utf-8" });
}
