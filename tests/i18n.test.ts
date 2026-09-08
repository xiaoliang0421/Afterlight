import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { translate, setLocale, getLocale, LOCALE_KEY } from "../src/i18n";
import { statusLabels } from "../src/components";
import { errorMessages } from "../worker/errors";
import { operationLabels } from "../shared/operations";
const catalog: Record<string, string> = JSON.parse(
  readFileSync("src/locales/zh-CN.json", "utf8"),
);

test("Chinese catalog covers literal UI calls and operational labels without losing parameters", () => {
  for (const name of readdirSync("src").filter((n) => /\.tsx?$/.test(n))) {
    const source = readFileSync(`src/${name}`, "utf8");
    for (const match of source.matchAll(
      /\b(?:tr|t)\(\s*("(?:[^"\\]|\\.)*")/g,
    )) {
      const key = JSON.parse(match[1]);
      assert.ok(Object.hasOwn(catalog, key), `${name}: missing ${key}`);
    }
  }
  for (const key of [
    ...Object.values(statusLabels),
    ...Object.values(operationLabels),
    ...Object.values(errorMessages),
  ])
    assert.ok(catalog[key], key);
  const parameters = (s: string) =>
    [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
  for (const [source, target] of Object.entries(catalog)) {
    assert.ok(target.trim(), source);
    assert.deepEqual(parameters(target), parameters(source), source);
  }
});

test("translation preserves opaque content and substitutes values only once", () => {
  assert.equal(
    translate(
      "en",
      "Scene {0}: {1}, by {2}",
      2,
      "The Lighthouse Mark",
      "Liang",
    ),
    "Scene 2: The Lighthouse Mark, by Liang",
  );
  assert.equal(
    translate(
      "zh-CN",
      "Scene {0}: {1}, by {2}",
      2,
      "The Lighthouse Mark",
      "Liang",
    ),
    "场景 2：The Lighthouse Mark，创作者 Liang",
  );
  assert.equal(
    translate("zh-CN", "{0} points", "<img src=x>{1}"),
    "<img src=x>{1} 点",
  );
  for (const unknown of [
    "The Lighthouse Mark",
    "toString",
    "__proto__",
    "constructor",
  ])
    assert.equal(translate("zh-CN", unknown), unknown);
});

test("locale selection works without writable browser storage and rejects invalid values", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("storage unavailable");
    },
  });
  try {
    setLocale("zh-CN");
    assert.equal(getLocale(), "zh-CN");
    setLocale("bad" as "en");
    assert.equal(getLocale(), "zh-CN");
    setLocale("en");
    assert.equal(getLocale(), "en");
    assert.equal(LOCALE_KEY, "talerelay.ui-language");
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("Chinese policy reading copy matches the complete canonical version and section structure", () => {
  const policies = JSON.parse(readFileSync("shared/policies.json", "utf8"));
  const translated = JSON.parse(
    readFileSync("src/locales/policies.zh-CN.json", "utf8"),
  );
  assert.equal(translated.version, policies.version);
  assert.equal(
    translated.sourceSha256,
    createHash("sha256").update(JSON.stringify(policies)).digest("hex"),
    "Update and review the Chinese copy when the English policy changes",
  );
  for (const kind of ["terms", "privacy"]) {
    assert.deepEqual(
      translated[kind].map((s: { id: string }) => s.id),
      policies[kind].map((s: { id: string }) => s.id),
    );
    policies[kind].forEach((section: { paragraphs: string[] }, i: number) => {
      assert.equal(
        translated[kind][i].paragraphs.length,
        section.paragraphs.length,
      );
      assert.ok(
        translated[kind][i].paragraphs.every((p: string) =>
          /[\u4e00-\u9fff]/.test(p),
        ),
      );
    });
  }
});
