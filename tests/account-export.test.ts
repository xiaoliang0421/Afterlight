import test from "node:test";
import assert from "node:assert/strict";
import { collectAccountExport } from "../src/account-export";
import type { ExportManifest, ExportPage } from "../shared/account-export";

const manifest: ExportManifest = {
  format: "talerelay-account-records-v1",
  accountId: "alice",
  startedAt: "2026-09-06T00:00:00.000Z",
  sections: [{ name: "ideas", through: 3, count: 2 }],
  notes: [],
};
function reader(page: (body: any) => ExportPage | Promise<ExportPage>) {
  return async <T>(path: string, body: unknown): Promise<T> =>
    (path === "/account/export" ? manifest : await page(body)) as T;
}
test("account download joins every page and keeps prompt text as data", async () => {
  const prompt = '</script>\n"unexpected":true, café';
  const cursors: number[] = [];
  const blob = await collectAccountExport(
    reader((input) => {
      cursors.push(input.after);
      return {
        accountId: "alice",
        section: "ideas",
        rows: [{ prompt, id: input.after ? "last" : "first" }],
        next: input.after ? null : 2,
      };
    }),
    new AbortController().signal,
    () => {},
  );
  const value = JSON.parse(await blob.text());
  assert.deepEqual(cursors, [0, 2]);
  assert.deepEqual(
    value.records.ideas.map((r: any) => r.id),
    ["first", "last"],
  );
  assert.equal(value.records.ideas[0].prompt, prompt);
  assert.ok(value.completedAt);
});
test("account download fails without a file on account switches, stalled cursors or later page errors", async () => {
  for (const kind of ["account", "cursor", "network"]) {
    await assert.rejects(
      collectAccountExport(
        reader((input) => {
          if (kind === "network" && input.after)
            throw new Error("Network failed");
          return {
            accountId: kind === "account" ? "bob" : "alice",
            section: "ideas",
            rows: [{ id: "one" }],
            next: kind === "cursor" ? input.after : 2,
          };
        }),
        new AbortController().signal,
        () => {},
      ),
      /changed|Network/,
    );
  }
});
test("account download respects cancellation and the byte ceiling", async () => {
  const controller = new AbortController();
  await assert.rejects(
    collectAccountExport(
      reader(() => {
        controller.abort();
        return { accountId: "alice", section: "ideas", rows: [], next: null };
      }),
      controller.signal,
      () => {},
    ),
    { name: "AbortError" },
  );
  await assert.rejects(
    collectAccountExport(
      reader(() => ({
        accountId: "alice",
        section: "ideas",
        rows: [{ text: "large".repeat(1000) }],
        next: null,
      })),
      new AbortController().signal,
      () => {},
      1000,
    ),
    /browser download limit/,
  );
});
