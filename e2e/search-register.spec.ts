import { expect, test } from "@playwright/test";

test("店名検索→即チェックイン→タイムライン反映→編集して保存まで一連の流れが動く", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("名前で記録").click();

  await page.fill("#venue-search", "E2Eテスト居酒屋");
  await page.getByText("「E2Eテスト居酒屋」で新規チェックイン").click();
  await expect(page.getByText("チェックインしました")).toBeVisible();

  await page.waitForTimeout(5500);
  await page.goto("/timeline");
  await expect(page.getByText("E2Eテスト居酒屋")).toBeVisible();

  await page.getByText("E2Eテスト居酒屋").click();
  await expect(page).toHaveURL(/\/visits\/[^/]+$/);

  // 名前で記録した記録も、後から登録画面でメモや誰と等を追記できる。
  await page.getByRole("link", { name: "編集する" }).click();
  await expect(page).toHaveURL(/\/visits\/.+\/register/);
  await page.getByRole("button", { name: "友人", exact: true }).click();
  await page.fill("#memo", "E2Eテストからの記録");
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page).toHaveURL(/\/timeline/);

  await page.getByText("E2Eテスト居酒屋").click();
  await expect(page).toHaveURL(/\/visits\/[^/]+$/);
  await expect(page.getByText("E2Eテストからの記録")).toBeVisible();
});
