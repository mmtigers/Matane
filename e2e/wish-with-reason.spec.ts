import { expect, test } from "@playwright/test";

// 車から見かけた店など、まだ行ったことのない店を店名検索→(候補選択)→理由タグ付きで
// 「気になる」に保存できることを確認する。CI環境ではNEXT_PUBLIC_GOOGLE_PLACES_API_KEY
// が未設定のため、Google検索候補は0件(手入力のみ)の経路を通る。
test("店名を検索し、気になる理由タグを付けて保存すると気になるリストに反映される", async ({
  page,
}) => {
  await page.goto("/");

  await page.fill("#venue-search", "E2E行きたいテスト店");
  await page.getByRole("button", { name: "☆ 気になるに保存" }).click();

  const wishDialog = page.getByRole("alertdialog", { name: "気になるに保存" });
  await expect(wishDialog).toBeVisible();

  await wishDialog.getByRole("button", { name: "おいしそう", exact: true }).click();
  await wishDialog.getByRole("button", { name: "保存する" }).click();

  await expect(page.getByText("「E2E行きたいテスト店」を気になるリストに追加しました")).toBeVisible();

  await page.goto("/wishlist");
  const item = page.getByText("E2E行きたいテスト店").locator("..");
  await expect(item.getByText("おいしそう")).toBeVisible();
});
