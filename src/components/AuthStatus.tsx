"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthProvider";
import { usePendingSyncCount } from "@/lib/db/queries";
import { getSupabaseClient } from "@/lib/supabase/client";

export function AuthStatus() {
  const { session, loading } = useAuth();
  const pendingCount = usePendingSyncCount();

  async function handleLogout() {
    try {
      await getSupabaseClient().auth.signOut();
    } catch (error) {
      console.error(error);
    }
  }

  if (loading) return null;

  if (!session) {
    return (
      <Link href="/login" className="text-xs text-amber-400 underline underline-offset-2">
        ログインして他の端末と同期する
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500">
      <span>{session.user.email}</span>
      {!!pendingCount && (
        <span className="text-amber-400">未同期{pendingCount}件</span>
      )}
      <button type="button" onClick={handleLogout} className="underline underline-offset-2">
        ログアウト
      </button>
    </div>
  );
}
