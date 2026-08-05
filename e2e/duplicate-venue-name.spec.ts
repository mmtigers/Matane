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

test("同名の店舗が複数あっても検索結果のクリック先と紐付け先が一致する", async ({ page }) => {
  // Venue A: 検索チェックインで作成
  await page.goto("/");
  await page.fill("#venue-search", "回帰テスト店");
  await page.getByText("「回帰テスト店」で新規チェックイン").click();
  await page.waitForURL(/\/visits\/.+\/register/);
  const visitIdA = page.url().match(/visits\/([^/]+)\/register/)?.[1] as string;
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page).toHaveURL(/\/timeline/);
  const venueIdA = await venueIdFromVisitDetail(page, visitIdA);

  // Venue B: 瞬録(GPS)で作成後、同じ店名を設定
  await page.goto("/");
  await page.waitForSelector("#venue-search");
  await page.getByText("今ココを瞬録").click();
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("チェックインしました")).toBeVisible();
  await page.waitForTimeout(5500);

  await page.goto("/timeline");
  await page.locator('span:has-text("盛り付け待ち")').first().click();
  await page.waitForURL(/\/visits\/.+\/register/);
  const visitIdB = page.url().match(/visits\/([^/]+)\/register/)?.[1] as string;
  await page.fill("#venue-name", "回帰テスト店");
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page).toHaveURL(/\/timeline/);
  const venueIdB = await venueIdFromVisitDetail(page, visitIdB);

  expect(venueIdA).not.toBe(venueIdB);

  // ホーム検索で2件表示される中からVenue B側の候補を明示的にタップし、
  // (Dexieの.toArray()はUUID主キー順のため画面上の並び順は作成順と一致しない)
  // タップした店舗と紐付け先が一致することを確認する。
  await page.goto("/");
  await page.fill("#venue-search", "回帰テスト店");
  const targetResult = page.locator(`button[data-venue-id="${venueIdB}"]`);
  await targetResult.click();
  await page.waitForURL(/\/visits\/.+\/register/);
  const visitIdC = page.url().match(/visits\/([^/]+)\/register/)?.[1] as string;
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page).toHaveURL(/\/timeline/);
  const venueIdC = await venueIdFromVisitDetail(page, visitIdC);

  expect(venueIdC).toBe(venueIdB);
});
