"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { deleteVisit } from "@/lib/db/checkin";
import { useVisitWithVenue } from "@/lib/db/queries";
import { googleMapsUrl, osmEmbedUrl } from "@/lib/geo";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-800 py-3 last:border-b-0">
      <span className="text-sm text-neutral-400">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export function VisitDetailClient({ visitId }: { visitId: string }) {
  const visit = useVisitWithVenue(visitId);
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleConfirmDelete() {
    if (!visit) return;
    setConfirmingDelete(false);
    setDeleting(true);
    try {
      await deleteVisit(visit.id);
      router.push("/timeline");
    } finally {
      setDeleting(false);
    }
  }

  if (!visit) {
    return <main className="px-4 pt-8 text-sm text-neutral-400">読み込み中...</main>;
  }

  if (!visit.is_completed) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-8">
        <p className="text-sm text-neutral-400">この記録はまだ盛り付け前です。</p>
        <Link
          href={`/visits/${visit.id}/register`}
          className="rounded-full bg-amber-400 py-4 text-center text-base font-semibold text-black"
        >
          盛り付けする
        </Link>
      </main>
    );
  }

  const visitDate = new Date(visit.visited_at);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header>
        {visit.venue && (
          <Link href={`/venues/${visit.venue.id}`} className="text-lg font-bold text-amber-300">
            {visit.venue.name || "店名未設定"}
          </Link>
        )}
        <p className="mt-1 text-xs text-neutral-400">
          {visitDate.toLocaleDateString("ja-JP", {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "short",
          })}
        </p>
      </header>

      {visit.best_photo && (
        // eslint-disable-next-line @next/next/no-img-element -- ローカルdata URL画像
        <img
          src={visit.best_photo}
          alt={visit.venue?.name ? `${visit.venue.name}での一枚` : "厳選の一枚"}
          className="h-64 w-full rounded-2xl object-cover"
        />
      )}

      <section className="rounded-2xl bg-neutral-900 px-4">
        <DetailRow label="誰と" value={visit.who.length > 0 ? visit.who.join(" / ") : "未記録"} />
        <DetailRow label="また行きたい" value={visit.revisit ?? "未記録"} />
        <DetailRow label="予算感" value={visit.budget ?? "未記録"} />
        <DetailRow
          label="お酒の武器"
          value={visit.alcohol_tags.length > 0 ? visit.alcohol_tags.join(" / ") : "未記録"}
        />
        <DetailRow label="静かさ" value={visit.quietness ?? "未記録"} />
      </section>

      {visit.memo && (
        <section className="rounded-2xl bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-neutral-400">メモ</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-200">{visit.memo}</p>
        </section>
      )}

      {visit.venue?.location && (
        <section className="flex flex-col gap-2 rounded-2xl bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-neutral-400">📍 チェックインした場所</h2>
          <iframe
            title="チェックインした場所の地図"
            src={osmEmbedUrl(visit.venue.location)}
            className="h-48 w-full rounded-xl border-0"
            loading="lazy"
          />
          <a
            href={googleMapsUrl(visit.venue.location)}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start text-xs text-amber-400 underline underline-offset-2 focus:ring-2 focus:ring-amber-400"
          >
            Googleマップで開く
          </a>
        </section>
      )}

      <div className="flex gap-3">
        <Link
          href={`/visits/${visit.id}/register`}
          className="flex-1 rounded-full bg-neutral-800 py-3 text-center text-sm font-semibold text-neutral-200 focus:ring-2 focus:ring-amber-400"
        >
          編集する
        </Link>
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={deleting}
          className="flex-1 rounded-full bg-neutral-800 py-3 text-sm font-semibold text-red-400 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
        >
          {deleting ? "削除中..." : "削除する"}
        </button>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        message={`${visit.venue?.name || "この記録"}を削除しますか？この操作は取り消せません。`}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </main>
  );
}
