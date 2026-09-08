import { test, expect, request as playwrightRequest } from "@playwright/test";
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
  const denied = await request.patch(`/api/stories/${story.id}`, {
    data: { status: "open" },
    headers: { Origin: "http://127.0.0.1:5178" },
  });
  expect(denied.status()).toBe(409);
  const staff = await playwrightRequest.newContext({
    baseURL: "http://127.0.0.1:5178",
    extraHTTPHeaders: { Origin: "http://127.0.0.1:5178" },
  });
  await staff.post("/api/dev/login", { data: { persona: "studio" } });
  const review = await (
    await staff.get(`/api/admin/community/stories/${story.id}`)
  ).json();
  const approved = await staff.post(
    `/api/admin/community/stories/${story.id}`,
    {
      data: {
        action: "approve",
        token: review.token,
        reviewed: true,
        reason:
          "Reviewed the synthetic coastal story and its character details.",
      },
    },
  );
  expect(approved.ok(), await approved.text()).toBeTruthy();
  await staff.dispose();
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

test("no-payment account hides checkout prompts and studio reviews story introductions", async ({
  page,
}, info) => {
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post(`/api${path}`, {
      data,
      headers: { Origin: "http://127.0.0.1:5178" },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
  };
  await post("/dev/login", { persona: "creator" });
  await post("/account/policies", {
    version: policies.version,
    termsAccepted: true,
    privacyAcknowledged: true,
  });
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Your storyteller account." }),
  ).toBeVisible();
  await expect(
    page.getByText("Purchases are not offered in this release.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Top up creation points", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".billing-panel")).toHaveCount(0);
  const title = `Review pilot ${info.project.name}`;
  const story = (
    await post("/stories", {
      title,
      logline:
        "A courier finds a sealed letter at a quiet coastal post office.",
      genre: "Mystery",
      worldRules:
        "The coastal village follows ordinary physical causality and chronological time.",
      visualStyle:
        "Restrained hand-painted illustration with clear English text.",
      characters: [
        {
          name: "Nora",
          description: "A night courier wearing a dark wool coat.",
          state: "Waiting beside the sorting desk.",
        },
      ],
    })
  ).story;
  await post("/dev/login", { persona: "studio" });
  await page.goto("/studio");
  await page
    .getByRole("tab", { name: "Stories & community", exact: true })
    .click();
  const card = page
    .locator(".community-list article")
    .filter({ has: page.getByText(title, { exact: true }) });
  await expect(card).toContainText("pending");
  await card.getByRole("button", { name: "Review story", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve & open", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "Characters", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /I reviewed the title/ }).check();
  await page
    .getByLabel("Decision reason")
    .fill("Reviewed the actual synthetic introduction, characters and cover.");
  await page
    .getByRole("button", { name: "Approve & open", exact: true })
    .click();
  await expect(card).toContainText("approved");
  const state = await (
    await page.request.get(`/api/stories/${story.id}`)
  ).json();
  expect(state.story.status).toBe("open");
  expect(state.story.reviewStatus).toBe("approved");
  await page.screenshot({
    path: info.outputPath("community-review.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  // UI contract for the provider-disabled bootstrap; offer gating is also tested against D1.
  await post("/dev/login", { persona: "creator" });
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.config.textEnabled = false;
    body.config.referenceEnabled = false;
    body.config.generationEnabled = false;
    body.config.providerMode = "disabled";
    await route.fulfill({ response, json: body });
  });
  await page.goto(`/story/${story.slug}`);
  await page.getByRole("button", { name: "Make a scene", exact: true }).click();
  await expect(page.getByLabel(/^MP4 video/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate with points", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("upload-only.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
