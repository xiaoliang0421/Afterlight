import { test, expect } from "@playwright/test";
test("watch, identify a scene author and switch independent worlds", async ({
  page,
}) => {
  await page.goto("/story/the-last-light");
  await expect(
    page.getByRole("heading", { name: "The Last Light", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Scene 2: A voice in the static, by Afterlight Studio",
      exact: true,
    })
    .click();
  await expect(page.locator(".prompt-popover")).toContainText(
    "Afterlight Studio",
  );
  await expect(page.locator(".prompt-popover")).toContainText("0:10");
  await page
    .getByRole("button", { name: "The Last Light", exact: true })
    .click();
  await page
    .getByRole("link", { name: "The Quiet Orbit", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "The Quiet Orbit", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "Playback position" }),
  ).toHaveAttribute("max", "10000");
  await expect(
    page.getByRole("textbox", { name: "Your idea for The Quiet Orbit" }),
  ).toBeVisible();
});
