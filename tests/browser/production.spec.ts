import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const policies = JSON.parse(readFileSync("shared/policies.json", "utf8"));

test("host sees paid generation and can retry a finished upload without spending points", async ({
  page,
}, info) => {
  const request = page.request;
  const post = async (path: string, data: unknown) => {
    const r = await request.post(`/api${path}`, {
      data,
      headers: { Origin: "http://127.0.0.1:5178" },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  await post("/dev/login", {
    persona: info.project.name === "mobile" ? "creator" : "studio",
  });
  await post("/account/policies", {
    version: policies.version,
    termsAccepted: true,
    privacyAcknowledged: true,
  });
  const story = (
    await post("/stories", {
      title: `The coast ${info.project.name}`,
      logline:
        "A lighthouse keeper waits for the next signal from the rocky coastline.",
      genre: "Mystery",
      worldRules:
        "An ordinary coastal town. Events follow ordinary physical laws and chronological time.",
      visualStyle: "Natural coastal light and restrained film grain.",
      characters: [
        {
          name: "Keeper",
          description: "A quiet lighthouse keeper wearing a dark raincoat.",
          state: "Waiting inside the lighthouse.",
        },
      ],
    })
  ).story;
  const opened = await request.patch(`/api/stories/${story.id}`, {
    data: { status: "open" },
    headers: { Origin: "http://127.0.0.1:5178" },
  });
  expect(opened.ok()).toBeTruthy();
  const before = (await (await request.get("/api/bootstrap")).json()).wallet;
  await page.goto(`/story/${story.slug}`);
  await page.getByRole("button", { name: "Make a scene", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Generate with points", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".generation-choice")).toContainText(/5 points/i);
  await page
    .getByRole("button", { name: "Upload a finished video", exact: true })
    .click();
  await page
    .getByLabel(/^MP4 video/)
    .setInputFiles("public/samples/playback.mp4");
  await page.getByLabel("Scene title").fill("The coastal beacon");
  await page
    .getByLabel("What actually happens")
    .fill("A lighthouse stands above a rocky coastline.");
  await page
    .getByLabel("How it continues the latest scene")
    .fill("The story opens outside the keeper's lighthouse.");
  await page
    .getByLabel("New story facts")
    .fill("The lighthouse beam crosses the coast.");
  await page
    .getByRole("checkbox", { name: /I have permission to publish/ })
    .check();
  await page.getByRole("button", { name: "Prepare upload" }).click();
  await expect(
    page.getByRole("button", { name: "Upload video", exact: true }),
  ).toBeVisible();
  await page.route(
    "**/api/production/*/file",
    (route) => route.abort("connectionreset"),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Upload video", exact: true }).click();
  await expect(
    page.getByText(
      "The connection was interrupted. Keep this file and retry the upload.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Upload video", exact: true }).click();
  const video = page.locator(".upload-review video");
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.5);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await page.screenshot({
    path: info.outputPath("host-upload.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("checkbox", { name: /I watched the full uploaded video/ })
    .check();
  await page
    .getByRole("checkbox", { name: /Submit this video for publication/ })
    .check();
  await page.getByRole("button", { name: /Submit for story review/ }).click();
  await expect(
    page.getByText("Follow this scene in Your contributions"),
  ).toBeVisible();
  const after = (await (await request.get("/api/bootstrap")).json()).wallet;
  expect(after).toEqual(before);
});
