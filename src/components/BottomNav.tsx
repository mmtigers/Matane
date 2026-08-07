"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCompletedVisitCount, useWishedVenues } from "@/lib/db/queries";

const items = [
  { href: "/", label: "ホーム", icon: "🏠" },
  { href: "/timeline", label: "タイムライン", icon: "📅" },
  { href: "/wishlist", label: "行きたい", icon: "⭐" },
  { href: "/stats", label: "統計", icon: "📊" },
  { href: "/map", label: "マップ", icon: "🗺️" },
] as const;

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold leading-none text-black">
      {count > 99 ? "99+" : count}
    </span>
  );
}

// 片手操作前提のため画面下部に固定。iOSのホームインジケーター分もセーフエリアで確保する。
export function BottomNav() {
  const pathname = usePathname();
  const wishedVenues = useWishedVenues();
  const completedVisitCount = useCompletedVisitCount();

  const badgeCounts: Partial<Record<(typeof items)[number]["href"], number>> = {
    "/wishlist": wishedVenues?.length ?? 0,
    "/stats": completedVisitCount ?? 0,
  };

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/90 backdrop-blur-sm [padding-bottom:env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-md">
        {items.map((item) => {
          const active = pathname === item.href;
          const badgeCount = badgeCounts[item.href] ?? 0;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] focus:ring-2 focus:ring-amber-400 ${
                  active ? "text-amber-600" : "text-neutral-500"
                }`}
              >
                <span className="relative text-lg leading-none">
                  {item.icon}
                  <NavBadge count={badgeCount} />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
