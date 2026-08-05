import { expect, test } from "@playwright/test";

test("店名検索→チェックイン→盛り付け→タイムライン反映まで一連の流れが動く", async ({ page }) => {
  await page.goto("/");

  await page.fill("#venue-search", "E2Eテスト居酒屋");
  await page.getByText("「E2Eテスト居酒屋」で新規チェックイン").click();
  await expect(page).toHaveURL(/\/visits\/.+\/register/);

  await page.getByRole("button", { name: "友人", exact: true }).click();
  await page.getByRole("button", { name: "絶対行く", exact: true }).click();
  await page.getByRole("button", { name: "〜5k", exact: true }).click();
  await page.getByRole("button", { name: "ビール", exact: true }).click();
  await page.getByRole("button", { name: "静か", exact: true }).click();
  await page.fill("#memo", "E2Eテストからの記録");

  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page).toHaveURL(/\/timeline/);

  await expect(page.getByText("E2Eテスト居酒屋")).toBeVisible();

  await page.getByText("E2Eテスト居酒屋").click();
  await expect(page).toHaveURL(/\/visits\/[^/]+$/);
  await expect(page.getByText("E2Eテストからの記録")).toBeVisible();
});
