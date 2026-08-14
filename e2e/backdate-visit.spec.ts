import { expect, test } from "@playwright/test";

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

test("「名前で記録」で過去日付を指定すると、その日付でVisitが作成され、後から修正もできる", async ({
  page,
}) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayValue = toDateInputValue(yesterday);

  await page.goto("/");
  await page.getByText("名前で記録").click();

  await page.fill("#venue-search", "E2E後から記録テスト店");
  await page.fill("#named-register-date", yesterdayValue);
  await page.getByText("「E2E後から記録テスト店」で新規チェックイン").click();
  await expect(page.getByText("チェックインしました")).toBeVisible();

  await page.waitForTimeout(5500);
  await page.goto("/timeline");
  await page.getByText("E2E後から記録テスト店").click();
  await expect(page).toHaveURL(/\/visits\/[^/]+$/);

  // 作成直後のVisitが「今日」ではなく指定した過去日付になっていることを確認する
  // (回帰: visited_atがnew Date()に固定で丸められてしまうと今日の日付になる)。
  await expect(page.getByText(formatDateLabel(yesterday))).toBeVisible();

  // 既存Visitの日付を登録画面から修正できることも合わせて確認する
  // (以前はvisited_atが読み取り専用で、一切修正手段がなかった)。
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const twoDaysAgoValue = toDateInputValue(twoDaysAgo);

  await page.getByRole("link", { name: "編集する" }).click();
  await expect(page).toHaveURL(/\/visits\/.+\/register/);
  await page.fill("#visited-at", `${twoDaysAgoValue}T10:00`);
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page).toHaveURL(/\/timeline/);

  await page.getByText("E2E後から記録テスト店").click();
  await expect(page).toHaveURL(/\/visits\/[^/]+$/);
  await expect(page.getByText(formatDateLabel(twoDaysAgo))).toBeVisible();
});
