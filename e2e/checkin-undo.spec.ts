import { expect, test } from "@playwright/test";

test.use({
  geolocation: { latitude: 35.6812, longitude: 139.7671 },
  permissions: ["geolocation"],
});

test("瞬録チェックイン後、5秒以内ならアンドゥで取り消せる", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#venue-search");

  await page.getByText("瞬録する").click();
  await page.getByRole("alertdialog", { name: "名前わかる？" }).waitFor();
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("alertdialog", { name: "写真を1枚" }).waitFor();
  await page.getByRole("button", { name: "写真なしで登録" }).click();
  await expect(page.getByText("チェックインしました")).toBeVisible();

  await page.getByRole("button", { name: "取り消す" }).click();
  await expect(page.getByText("チェックインしました")).not.toBeVisible();

  // 取り消した記録はタイムラインにも出てこない
  await page.goto("/timeline");
  await expect(page.getByText("登録待ち")).not.toBeVisible();
});
