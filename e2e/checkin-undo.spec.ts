import { expect, test } from "@playwright/test";

test.use({
  geolocation: { latitude: 34.7818, longitude: 135.4386 },
  permissions: ["geolocation"],
});

test("瞬録チェックイン後、5秒以内ならアンドゥで取り消せる", async ({ page }) => {
  await page.goto("/");
  // mode(夜間/日中)はクライアント側hydration後に確定するため、モード非依存の
  // 要素(検索欄)が出るまで待ってからトグルボタンの有無を判定する。
  await page.waitForSelector("#venue-search");

  const nightToggle = page.getByText("🌙 夜間モードに切替");
  if (await nightToggle.isVisible().catch(() => false)) {
    await nightToggle.click();
  }

  await page.getByText("今ココを瞬録").click();
  await expect(page.getByText("チェックインしました")).toBeVisible();

  await page.getByRole("button", { name: "取り消す" }).click();
  await expect(page.getByText("チェックインしました")).not.toBeVisible();

  // 取り消した記録は日中モードの「盛り付け待ち」にも出てこない
  const dayToggle = page.getByText("☀️ 日中モードに切替");
  if (await dayToggle.isVisible().catch(() => false)) {
    await dayToggle.click();
  }
  await expect(page.getByText("盛り付け待ちの訪問はありません。")).toBeVisible();
});
