import { expect, test } from "@playwright/test";

test.use({
  geolocation: { latitude: 35.6812, longitude: 139.7671 },
  permissions: ["geolocation"],
});

test("瞬録チェックイン後、5秒以内ならアンドゥで取り消せる", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#venue-search");

  await page.getByText("今ココを瞬録").click();
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("チェックインしました")).toBeVisible();

  await page.getByRole("button", { name: "取り消す" }).click();
  await expect(page.getByText("チェックインしました")).not.toBeVisible();

  // 取り消した記録は「盛り付け待ち」にも出てこない
  await expect(page.getByText("⚠️ 盛り付け待ち")).not.toBeVisible();
});
