interface BarRowProps {
  label: string;
  count: number;
  max: number;
}

// 統計ダッシュボードの棒グラフ1行分。新規ライブラリを増やさず既存のTailwindパターンで表現する。
export function BarRow({ label, count, max }: BarRowProps) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-20 flex-none truncate text-neutral-300">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 flex-none text-right text-neutral-400">{count}</span>
    </div>
  );
}
