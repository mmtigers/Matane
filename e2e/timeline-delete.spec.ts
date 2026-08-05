import { expect, test } from "@playwright/test";

test("タイムラインから記録を削除できる(確認ダイアログ経由)", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());

  await page.goto("/");
  await page.fill("#venue-search", "削除テスト店");
  await page.getByText("「削除テスト店」で新規チェックイン").click();
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page).toHaveURL(/\/timeline/);

  await expect(page.getByText("削除テスト店")).toBeVisible();

  await page.getByRole("button", { name: "削除" }).first().click();

  await expect(page.getByText("削除テスト店")).not.toBeVisible();
});
