import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const policies = JSON.parse(readFileSync("shared/policies.json", "utf8"));
async function language(page: Page, target: "en" | "zh-CN") {
  await page.locator(".preferences-link").click();
  const dialog = page.locator("dialog");
  await dialog
    .getByRole("button", {
      name: target === "zh-CN" ? "简体中文" : "English",
      exact: true,
    })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", target);
  await dialog
    .getByRole("button", {
      name: target === "zh-CN" ? "完成" : "Done",
      exact: true,
    })
    .click();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
}
async function localLogin(page: Page) {
  const headers = { Origin: "http://127.0.0.1:5178" };
  expect(
    (
      await page.request.post("/api/dev/login", {
        headers,
        data: { persona: "studio" },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.post("/api/account/policies", {
        headers,
        data: {
          version: policies.version,
          termsAccepted: true,
          privacyAcknowledged: true,
        },
      })
    ).ok(),
  ).toBeTruthy();
}

test("anonymous footer preference persists, preserves playback and does not submit consent", async ({
  page,
}, info) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/") && !["GET", "HEAD"].includes(r.method()))
      writes.push(r.url());
  });
  // Serve the existing synthetic MP4 explicitly; fixture API media is not seeded in R2.
  await page.route("**/api/scenes/sample-*/video", (route) =>
    route.fulfill({
      path: "public/samples/playback.mp4",
      contentType: "video/mp4",
    }),
  );
  await page.goto("/story/the-last-light");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("banner").getByText("Preferences")).toHaveCount(
    0,
  );
  await expect(page.locator(".site-footer .preferences-link")).toHaveCount(1);
  // Preserve the actual media element and its position across the language update.
  const media = page.locator("video").first();
  await media.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await expect
    .poll(() => media.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(1);
  const before = await media.evaluate((v: HTMLVideoElement) => {
    v.pause();
    v.dataset.languageTest = "same-node";
    return v.currentTime;
  });
  await language(page, "zh-CN");
  await expect(
    page.getByRole("heading", { name: "The Last Light", exact: true }),
  ).toBeVisible();
  await expect(media).toHaveAttribute("data-language-test", "same-node");
  expect(
    await media.evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeGreaterThanOrEqual(before - 0.1);
  await expect(
    page.getByRole("tab", { name: "世界与角色", exact: true }),
  ).toBeVisible();
  await page.locator(".watch-page").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("chinese-story.png"),
    fullPage: true,
  });
  await noOverflow(page);
  await page.reload();
  await expect(page.locator(".preferences-link")).toHaveText("偏好设置");
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { name: "隐私政策", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#information")).toContainText("我们使用的信息");
  await expect(page.locator(".legal-version")).toContainText(policies.version);
  await page.getByRole("button", { name: "查看英文原文" }).click();
  await expect(page.locator("#information")).toContainText(
    "Information we use",
  );
  await page.getByRole("button", { name: "阅读中文译文" }).click();
  await expect(page.locator("#information")).toContainText("账户信息");
  await noOverflow(page);
  await language(page, "en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(
    writes.filter((u) =>
      /policies|tasks|proposals|production|billing|auth/.test(u),
    ),
  ).toEqual([]);
});

test("Chinese form, filters and studio keep canonical values and entered drafts", async ({
  page,
}, info) => {
  await localLogin(page);
  await page.goto("/create");
  await page
    .getByLabel("Story title", { exact: true })
    .fill("Keep my English draft");
  await page
    .getByLabel("The one-sentence invitation", { exact: true })
    .fill("An original idea that should remain exactly as entered.");
  await language(page, "zh-CN");
  await expect(page.getByLabel("故事标题", { exact: true })).toHaveValue(
    "Keep my English draft",
  );
  await expect(
    page.getByLabel("用一句话邀请观众", { exact: true }),
  ).toHaveValue("An original idea that should remain exactly as entered.");
  await page
    .getByLabel("类型", { exact: true })
    .selectOption({ label: "科幻" });
  await expect(page.getByLabel("类型", { exact: true })).toHaveValue(
    "Science fiction",
  );
  await page.screenshot({
    path: info.outputPath("chinese-create.png"),
    fullPage: true,
  });
  await noOverflow(page);
  await language(page, "en");
  await expect(page.getByLabel("Story title", { exact: true })).toHaveValue(
    "Keep my English draft",
  );
  await expect(page.getByLabel("Genre", { exact: true })).toHaveValue(
    "Science fiction",
  );
  await language(page, "zh-CN");
  await page.goto("/discover");
  await page.getByRole("button", { name: "科幻", exact: true }).click();
  await expect(page.locator(".story-card")).toContainText(["The Quiet Orbit"]);
  await page.goto("/studio");
  await page.getByRole("tab", { name: "故事与社区", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "邀请与公开昵称" }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("chinese-studio.png"),
    fullPage: true,
  });
  await noOverflow(page);
  await page.getByRole("tab", { name: "运行状态", exact: true }).click();
  await expect(page.getByRole("heading", { name: "恢复与保护" })).toBeVisible();
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "你的创作者账户。" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "购买点数", exact: true }),
  ).toHaveCount(0);
  await noOverflow(page);
});

test("unknown stored locale falls back and browser network failures read in Chinese", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("talerelay.ui-language", "invalid"),
  );
  await page.goto("/about");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await language(page, "zh-CN");
  // Client-side navigation keeps the selected language; failed API state remains readable.
  await page.route("**/api/stories/not-a-real-story", (route) =>
    route.abort("connectionfailed"),
  );
  await page.evaluate(() => {
    history.pushState({}, "", "/story/not-a-real-story");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("alert")).toContainText(
    "请求未能发送，请检查网络后重试。",
  );
  await expect(
    page.getByRole("button", { name: "重试", exact: true }),
  ).toBeVisible();
});
