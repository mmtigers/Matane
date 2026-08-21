"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { SkeletonList } from "@/components/Skeleton";
import {
  importWishedVenues,
  toggleVenueWish,
  type ImportWishedVenuesResult,
} from "@/lib/db/checkin";
import type { LocalVenue } from "@/lib/db/localDb";
import { useWishedVenues } from "@/lib/db/queries";
import {
  GoogleMapsImportError,
  parseGoogleMapsImportFile,
  type ImportedPlace,
} from "@/lib/googleMapsImport";

const UNDO_VISIBLE_MS = 5000;
const IMPORT_PREVIEW_COUNT = 8;

export default function WishlistPage() {
  const venues = useWishedVenues();
  const [undoVenue, setUndoVenue] = useState<LocalVenue | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<{ places: ImportedPlace[]; truncated: number } | null>(
    null
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportWishedVenuesResult | null>(null);

  useEffect(() => {
    if (!undoVenue) return;
    const timer = setTimeout(() => setUndoVenue(null), UNDO_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [undoVenue]);

  useEffect(() => {
    if (!importResult) return;
    const timer = setTimeout(() => setImportResult(null), 4000);
    return () => clearTimeout(timer);
  }, [importResult]);

  async function handleRemove(venue: LocalVenue) {
    await toggleVenueWish(venue.id, false);
    setUndoVenue(venue);
  }

  async function handleUndo() {
    if (!undoVenue) return;
    await toggleVenueWish(undoVenue.id, true);
    setUndoVenue(null);
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImportError(null);
    try {
      const text = await file.text();
      setImportPreview(parseGoogleMapsImportFile(file.name, text));
    } catch (error) {
      console.error(error);
      setImportError(
        error instanceof GoogleMapsImportError ? error.message : "ファイルの読み込みに失敗しました"
      );
    }
  }

  async function handleConfirmImport() {
    if (!importPreview) return;
    setImporting(true);
    try {
      const result = await importWishedVenues(importPreview.places);
      setImportResult(result);
      setImportPreview(null);
    } catch (error) {
      console.error(error);
      setImportError("インポートに失敗しました");
    } finally {
      setImporting(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">気になる店</h1>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-full bg-neutral-100 px-3 py-2 text-xs font-semibold text-amber-600 focus:ring-2 focus:ring-amber-400"
        >
          📥 Googleマップからインポート
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.kml,text/csv,application/vnd.google-earth.kml+xml"
          className="hidden"
          onChange={handleImportFileChange}
        />
      </header>

      {importError && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{importError}</p>
      )}

      {!venues ? (
        <SkeletonList />
      ) : venues.length === 0 ? (
        <p className="text-sm text-neutral-600">
          店舗詳細画面の☆ボタンや、ホーム画面の検索から「気になる店」に追加できます。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {venues.map((venue) => (
            <li
              key={venue.id}
              className="flex items-center gap-2 rounded-xl bg-neutral-100 px-4 py-3"
            >
              <Link href={`/venues/${venue.id}`} className="flex-1 min-w-0">
                <p className="text-sm font-medium">{venue.name || "店名未設定"}</p>
                {(venue.nearest_station || venue.address) && (
                  <p className="text-xs text-neutral-600">
                    {venue.nearest_station || venue.address}
                  </p>
                )}
                {venue.wish_reason && venue.wish_reason.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {venue.wish_reason.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] text-amber-600"
                      >
                        {reason}
                      </span>
                    ))}
                  </p>
                )}
              </Link>
              <button
                type="button"
                onClick={() => handleRemove(venue)}
                aria-label="気になるリストから外す"
                className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-lg text-amber-600 focus:ring-2 focus:ring-amber-400 active:bg-neutral-200"
              >
                ⭐
              </button>
            </li>
          ))}
        </ul>
      )}

      {undoVenue && (
        <div className="fixed inset-x-4 bottom-24 z-50 flex items-center justify-between rounded-xl bg-neutral-200 px-4 py-3 shadow-lg">
          <span className="text-sm">
            {undoVenue.name || "この店"}を気になるから外しました
          </span>
          <button
            type="button"
            onClick={handleUndo}
            className="text-sm font-semibold text-amber-600 focus:ring-2 focus:ring-amber-400"
          >
            取り消す
          </button>
        </div>
      )}

      {importPreview && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Googleマップからインポート"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
          onClick={() => setImportPreview(null)}
        >
          <div
            className="mx-4 mb-24 w-full max-w-sm rounded-2xl bg-neutral-100 p-5 sm:mb-0"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm text-neutral-900">
              {importPreview.places.length}件のお店が見つかりました
            </p>
            <p className="mt-1 text-xs text-neutral-600">
              まとめて「気になる」に追加します。座標を読み取れなかった場所は、後で店舗詳細画面から位置情報を設定できます。
            </p>
            {importPreview.truncated > 0 && (
              <p className="mt-1 text-xs text-amber-600">
                件数が多いため、あと{importPreview.truncated}件は今回取り込まれません。
              </p>
            )}

            <ul className="mt-3 flex max-h-48 flex-col gap-1 overflow-y-auto text-sm text-neutral-700">
              {importPreview.places.slice(0, IMPORT_PREVIEW_COUNT).map((place, index) => (
                <li key={`${place.name}-${index}`} className="flex items-center gap-1.5">
                  <span className="flex-none">{place.location ? "📍" : "・"}</span>
                  <span className="truncate">{place.name}</span>
                </li>
              ))}
              {importPreview.places.length > IMPORT_PREVIEW_COUNT && (
                <li className="text-xs text-neutral-500">
                  他{importPreview.places.length - IMPORT_PREVIEW_COUNT}件
                </li>
              )}
            </ul>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                disabled={importing}
                className="flex-1 rounded-full bg-neutral-200 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={importing}
                className="flex-1 rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                {importing ? "インポート中..." : "インポートする"}
              </button>
            </div>
          </div>
        </div>
      )}

      {importResult && (
        <div className="fixed inset-x-4 bottom-24 z-50 rounded-xl bg-neutral-200 px-4 py-3 text-center text-sm shadow-lg">
          {importResult.added + importResult.updated}件を気になるに追加しました
          {importResult.skipped > 0 && `（${importResult.skipped}件はすでに登録済みでした）`}
        </div>
      )}
    </main>
  );
}
