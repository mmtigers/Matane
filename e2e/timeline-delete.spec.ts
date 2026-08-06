import { expect, test } from "@playwright/test";

test("タイムラインから記録を削除できる(確認モーダル経由)", async ({ page }) => {
  await page.goto("/");
  await page.fill("#venue-search", "削除テスト店");
  await page.getByText("「削除テスト店」で新規チェックイン").click();
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page).toHaveURL(/\/timeline/);

  await expect(page.getByText("削除テスト店")).toBeVisible();

  await page.getByRole("button", { name: "削除" }).first().click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "削除する" }).click();

  // exact指定なし(部分一致)だと、閉じきる前のConfirmDialogの確認メッセージ
  // (「削除テスト店を削除しますか？...」)にも一致してstrict modeエラーになる
  // ことがあるため、タイムライン項目のテキストと完全一致するものだけを見る。
  await expect(page.getByText("削除テスト店", { exact: true })).not.toBeVisible();
});
