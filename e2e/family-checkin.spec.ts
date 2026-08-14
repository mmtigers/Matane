import path from "node:path";
import { expect, test } from "@playwright/test";

test.use({
  geolocation: { latitude: 35.6812, longitude: 139.7671 },
  permissions: ["geolocation"],
});

// 「ココを記録」は、飲み屋向けの二次登録(誰と/また行きたい/予算感/お酒の武器/静かさ)を
// 経由せず、名前確認〜写真1枚〜送信までダイアログ内の1操作で完結する。
test("ココを記録は写真登録まで一気通貫で完了し、登録待ちに残らない", async ({ page }) => {
  await page.goto("/");

  await page.getByText("ココを記録").click();
  await page.getByRole("alertdialog", { name: "名前わかる？" }).waitFor();
  await page.fill(
    'input[placeholder="候補にない場合は入力(わからなければ空欄でOK)"]',
    "E2Eテスト公園"
  );
  await page.getByRole("button", { name: "次へ" }).click();

  await page.getByRole("alertdialog", { name: "写真を1枚" }).waitFor();
  await page.setInputFiles(
    'input[type="file"]',
    path.join(__dirname, "../public/icons/icon-192.png")
  );
  await expect(page.getByRole("button", { name: "登録する" })).toBeEnabled();
  await page.getByRole("button", { name: "登録する" }).click();

  await expect(page.getByText("チェックインしました")).toBeVisible();
  // ココを記録は作成と同時にis_completed: trueになるため、登録待ちには出てこない。
  await expect(page.getByText("登録待ち")).not.toBeVisible();

  await page.waitForTimeout(5500);
  await page.goto("/timeline");
  await page.getByText("E2Eテスト公園").click();
  await expect(page).toHaveURL(/\/visits\/[^/]+$/);

  // 飲み屋向けの項目(お酒の武器・静かさ等)は表示しない(新規Venueはfamilyカテゴリのため)。
  await expect(page.getByText("お酒の武器")).not.toBeVisible();
  await expect(page.getByText("静かさ")).not.toBeVisible();
});
