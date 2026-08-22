import { expect, test } from "@playwright/test";

test.use({
  geolocation: { latitude: 35.6812, longitude: 139.7671 },
  permissions: ["geolocation"],
});

test("店舗詳細から店を削除すると、あしあとからも訪問記録が消える", async ({ page }) => {
  await page.goto("/");
  await page.getByText("ココを記録").click();
  await page.getByRole("alertdialog", { name: "名前わかる？" }).waitFor();
  await page.fill(
    'input[placeholder="候補にない場合は入力(わからなければ空欄でOK)"]',
    "Venue削除テスト店"
  );
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("alertdialog", { name: "写真を1枚" }).waitFor();
  await page.getByRole("button", { name: "写真なしで登録" }).click();
  await expect(page.getByText("チェックインしました")).toBeVisible();
  await page.waitForTimeout(5500);

  await page.goto("/timeline");
  await expect(page.getByText("Venue削除テスト店", { exact: true })).toBeVisible();
  await page.getByText("Venue削除テスト店", { exact: true }).click();
  await page.waitForURL(/\/visits\//);

  await page.getByRole("link", { name: "Venue削除テスト店" }).click();
  await page.waitForURL(/\/venues\//);

  await page.getByRole("button", { name: "この店を削除する" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "削除する" }).click();

  await expect(page).toHaveURL(/\/timeline/);
  await expect(page.getByText("Venue削除テスト店", { exact: true })).not.toBeVisible();
});
