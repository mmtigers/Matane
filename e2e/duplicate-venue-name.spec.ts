import { expect, test } from "@playwright/test";

// 過去に発見・修正した回帰バグの再発防止テスト:
// 同名の店舗が複数存在する状態で検索結果を選んでも、タップした店舗と
// 別の店舗に誤って紐付かないことを確認する。
test.use({
  geolocation: { latitude: 35.6812, longitude: 139.7671 },
  permissions: ["geolocation"],
});

async function venueIdFromVisitDetail(page: import("@playwright/test").Page, visitId: string) {
  await page.goto(`/visits/${visitId}`);
  const href = await page.locator('a[href^="/venues/"]').first().getAttribute("href");
  return href?.replace("/venues/", "");
}

// タイムラインは新しい順に並ぶため、直前に作成したVisitは常に同名の中で一番上に来る。
async function latestVisitIdForVenueName(page: import("@playwright/test").Page, venueName: string) {
  await page.goto("/timeline");
  await page.getByText(venueName).first().click();
  await page.waitForURL(/\/visits\/[^/]+$/);
  return page.url().match(/visits\/([^/]+)$/)?.[1] as string;
}

test("同名の店舗が複数あっても検索結果のクリック先と紐付け先が一致する", async ({ page }) => {
  // Venue A: 「名前で登録」から作成
  await page.goto("/");
  await page.waitForSelector("#venue-search");
  await page.fill("#venue-search", "回帰テスト店");
  await page.getByText("「回帰テスト店」で新規チェックイン").click();
  await expect(page.getByText("チェックインしました")).toBeVisible();
  await page.waitForTimeout(5500);

  const visitIdA = await latestVisitIdForVenueName(page, "回帰テスト店");
  const venueIdA = await venueIdFromVisitDetail(page, visitIdA);

  // Venue B: 「瞬録する」(GPS)で同じ店名を入力して作成
  await page.goto("/");
  await page.waitForSelector("#venue-search");
  await page.getByText("瞬録する").click();
  await page.getByRole("alertdialog", { name: "名前わかる？" }).waitFor();
  await page.fill(
    'input[placeholder="候補にない場合は入力(わからなければ空欄でOK)"]',
    "回帰テスト店"
  );
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("alertdialog", { name: "写真を1枚" }).waitFor();
  await page.getByRole("button", { name: "写真なしで登録" }).click();
  await expect(page.getByText("チェックインしました")).toBeVisible();
  await page.waitForTimeout(5500);

  const visitIdB = await latestVisitIdForVenueName(page, "回帰テスト店");
  const venueIdB = await venueIdFromVisitDetail(page, visitIdB);

  expect(venueIdA).not.toBe(venueIdB);

  // ホーム検索で2件表示される中からVenue B側の候補を明示的にタップし、
  // (Dexieの.toArray()はUUID主キー順のため画面上の並び順は作成順と一致しない)
  // タップした店舗と紐付け先が一致することを確認する。
  await page.goto("/");
  await page.waitForSelector("#venue-search");
  await page.fill("#venue-search", "回帰テスト店");
  const targetResult = page.locator(`button[data-venue-id="${venueIdB}"]`);
  await targetResult.click();
  await expect(page.getByText("チェックインしました")).toBeVisible();
  await page.waitForTimeout(5500);

  const visitIdC = await latestVisitIdForVenueName(page, "回帰テスト店");
  const venueIdC = await venueIdFromVisitDetail(page, visitIdC);

  expect(venueIdC).toBe(venueIdB);
});
