import { expect, test } from "@playwright/test";

// Supabase未接続環境でもクラッシュせず、明確なエラーメッセージが出ることを確認する
// (実際のマジックリンク送信・認証完了はSupabaseプロジェクトが必要なためE2E対象外)。
test("ログイン画面でメール送信を試みた際、Supabase未接続なら分かりやすいエラーが出る", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("ログインして他の端末と同期する").click();
  await expect(page).toHaveURL(/\/login/);

  await page.fill('input[type="email"]', "e2e-test@example.com");
  await page.getByRole("button", { name: "ログインリンクを送る" }).click();

  await expect(
    page.getByText("ログインしなくてもこの端末での記録・閲覧は可能です")
  ).toBeVisible();
});
