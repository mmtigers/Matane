"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getSupabaseClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && session) {
      router.replace("/");
    }
  }, [loading, session, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setErrorMessage(null);
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setSent(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "ログインリンクの送信に失敗しました"
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-12">
      <header>
        <h1 className="text-lg font-bold">ログイン</h1>
        <p className="mt-1 text-sm text-neutral-500">
          メールアドレス宛にログイン用のリンクを送ります。パスワードは不要です。
        </p>
      </header>

      {sent ? (
        <div className="rounded-xl bg-neutral-900 p-4 text-sm text-neutral-200">
          <p>
            <span className="font-semibold text-amber-400">{email}</span>{" "}
            にログインリンクを送信しました。メール内のリンクを開いてください。
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="rounded-xl bg-neutral-900 px-4 py-3 text-base outline-none placeholder:text-neutral-600"
          />
          {errorMessage && <p className="text-sm text-red-400">{errorMessage}</p>}
          <button
            type="submit"
            disabled={sending}
            className="rounded-full bg-amber-400 py-4 text-base font-semibold text-black disabled:opacity-60"
          >
            {sending ? "送信中..." : "ログインリンクを送る"}
          </button>
        </form>
      )}

      <p className="text-xs text-neutral-500">
        ログインしなくてもこの端末での記録・閲覧は可能です。ログインすると他の端末ともデータが同期されます。
      </p>
    </main>
  );
}
