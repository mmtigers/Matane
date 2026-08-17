import { expect, test } from "@playwright/test";

// 車から見かけた店など、まだ行ったことのない店を店名検索→(候補選択)→理由タグ付きで
// 「気になる」に保存できることを確認する。CI環境ではNEXT_PUBLIC_GOOGLE_PLACES_API_KEY
// が未設定のため、Google検索候補は0件(手入力のみ)の経路を通る。「名前で記録」タップ後は
// まず「あしあと」か「気になる」かを選ぶステップがあり、「気になるに記録」を選んだ場合の
// 「登録する」は登録と同時に気になるリストへの追加を兼ねる(別ダイアログには分かれない)。
test("店名を検索し、気になる理由タグを付けて登録すると気になるリストに反映される", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByText("名前で記録").click();
  const modeDialog = page.getByRole("alertdialog", { name: "名前で記録" });
  await modeDialog.getByRole("button", { name: /気になるに記録/ }).click();

  const namedDialog = page.getByRole("alertdialog", { name: "名前で記録" });
  await namedDialog.locator("#venue-search").fill("E2E行きたいテスト店");
  await namedDialog.getByRole("button", { name: "おいしそう", exact: true }).click();
  await namedDialog.getByRole("button", { name: "登録する" }).click();

  await expect(page.getByText("「E2E行きたいテスト店」を気になるリストに追加しました")).toBeVisible();

  await page.goto("/wishlist");
  const item = page.getByText("E2E行きたいテスト店").locator("..");
  await expect(item.getByText("おいしそう")).toBeVisible();
});
