import { expect, test } from "@playwright/test";

test.use({
  geolocation: { latitude: 35.6812, longitude: 139.7671 },
  permissions: ["geolocation"],
});

test("タイムラインから記録を削除でき、5秒以内なら取り消せる", async ({ page }) => {
  await page.goto("/");
  await page.getByText("ココを記録").click();
  await page.getByRole("alertdialog", { name: "名前わかる？" }).waitFor();
  await page.fill(
    'input[placeholder="候補にない場合は入力(わからなければ空欄でOK)"]',
    "削除テスト店"
  );
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("alertdialog", { name: "写真を1枚" }).waitFor();
  await page.getByRole("button", { name: "写真なしで登録" }).click();
  await expect(page.getByText("チェックインしました")).toBeVisible();
  await page.waitForTimeout(5500);

  await page.goto("/timeline");
  await expect(page.getByText("削除テスト店", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "削除" }).first().click();

  // 確認モーダルを挟まず即座に削除され(行きたいリストと同じアンドゥ方式)、
  // 取り消しスナックバーが表示される。
  await expect(page.getByText("削除テスト店", { exact: true })).not.toBeVisible();
  await expect(page.getByText("削除テスト店を削除しました")).toBeVisible();

  await page.getByRole("button", { name: "取り消す" }).click();
  await expect(page.getByText("削除テスト店", { exact: true })).toBeVisible();
});
