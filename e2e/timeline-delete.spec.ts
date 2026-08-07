import { expect, test } from "@playwright/test";

test("タイムラインから記録を削除でき、5秒以内なら取り消せる", async ({ page }) => {
  await page.goto("/");
  await page.fill("#venue-search", "削除テスト店");
  await page.getByText("「削除テスト店」で新規チェックイン").click();
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page).toHaveURL(/\/timeline/);

  await expect(page.getByText("削除テスト店", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "削除" }).first().click();

  // 確認モーダルを挟まず即座に削除され(行きたいリストと同じアンドゥ方式)、
  // 取り消しスナックバーが表示される。
  await expect(page.getByText("削除テスト店", { exact: true })).not.toBeVisible();
  await expect(page.getByText("削除テスト店を削除しました")).toBeVisible();

  await page.getByRole("button", { name: "取り消す" }).click();
  await expect(page.getByText("削除テスト店", { exact: true })).toBeVisible();
});
