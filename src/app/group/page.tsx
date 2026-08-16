"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Skeleton } from "@/components/Skeleton";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  createGroup,
  createInvite,
  getActiveInvite,
  getGroupMembers,
  getMyGroup,
  joinGroupByCode,
  leaveGroup,
} from "@/lib/db/groups";
import { pullFromCloud } from "@/lib/db/sync";
import type { Group, GroupInvite, GroupMemberProfile } from "@/types/models";

const SHARE_COPIED_VISIBLE_MS = 2000;

// supabase-jsはHTTPレベルのエラー(PostgrestError等、Errorのサブクラス)だけでなく、
// fetch自体が失敗した場合(DNS/CORS/オフライン等)は素のオブジェクト
// { message, name, ... } を投げてくる。instanceof Errorだけで判定すると
// このケースを取りこぼしString(error)が"[object Object]"になってしまうため、
// messageプロパティの有無でも判定する。
function describeError(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return null;
}

export default function GroupPage() {
  const { session, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMemberProfile[]>([]);
  const [invite, setInvite] = useState<GroupInvite | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joining, setJoining] = useState(false);
  const [issuingInvite, setIssuingInvite] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const refresh = useCallback(async () => {
    const myGroup = await getMyGroup();
    setGroup(myGroup);
    if (myGroup) {
      const [memberList, activeInvite] = await Promise.all([
        getGroupMembers(),
        getActiveInvite(myGroup.id),
      ]);
      setMembers(memberList);
      setInvite(activeInvite);
    } else {
      setMembers([]);
      setInvite(null);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 未ログイン確定後に一度だけローディング表示を止める後始末で、フェッチ自体は発生しない
      setLoading(false);
      return;
    }
    refresh()
      .catch((error) => {
        console.error(error);
        const detail = describeError(error);
        setErrorMessage(
          detail ? `グループ情報の取得に失敗しました(${detail})` : "グループ情報の取得に失敗しました"
        );
      })
      .finally(() => setLoading(false));
  }, [authLoading, session, refresh]);

  useEffect(() => {
    if (!shareCopied) return;
    const timer = setTimeout(() => setShareCopied(false), SHARE_COPIED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [shareCopied]);

  // createGroup()自体は成功したのに直後のgetGroupMembers()/createInvite()だけが
  // ネットワーク瞬断等で失敗すると、group/membersのstateを更新しないまま
  // 「作成に失敗しました」を出してしまい、実際にはグループができているのに画面上は
  // 再作成しか選べない(再実行するとgroup_members.user_idのunique制約で必ず失敗する)
  // 詰み状態になっていた。グループ作成(groups+group_membersへのinsert)が成功した
  // 時点でstateを確定させ、以降のメンバー一覧取得・招待コード発行の失敗は
  // 「グループ作成の失敗」とは別の(発行し直せる)状態として扱う。
  async function handleCreateGroup() {
    if (creating) return;
    setErrorMessage(null);
    setCreating(true);
    let newGroup: Group;
    try {
      newGroup = await createGroup();
      setGroup(newGroup);
    } catch (error) {
      console.error(error);
      setErrorMessage(describeError(error) ?? "グループの作成に失敗しました");
      setCreating(false);
      return;
    }
    try {
      setMembers(await getGroupMembers());
    } catch (error) {
      console.error(error);
    }
    try {
      setInvite(await createInvite(newGroup.id));
    } catch (error) {
      console.error(error);
      const detail = describeError(error);
      setErrorMessage(
        `グループを作成しましたが、招待コードの発行に失敗しました。下のボタンから発行し直してください${
          detail ? `(${detail})` : ""
        }`
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinGroup() {
    setErrorMessage(null);
    setJoining(true);
    try {
      await joinGroupByCode(joinCodeInput);
      setJoinCodeInput("");
    } catch (error) {
      console.error(error);
      setErrorMessage(describeError(error) ?? "参加に失敗しました");
      setJoining(false);
      return;
    }
    // 参加自体(redeem_group_invite)は成功しているため、この後のrefresh失敗は
    // 致命的なエラーとして表示しない(画面再訪問・次回起動時に復旧する)。
    try {
      await refresh();
      void pullFromCloud();
    } catch (error) {
      console.error(error);
    } finally {
      setJoining(false);
    }
  }

  async function handleIssueInvite() {
    if (!group) return;
    setErrorMessage(null);
    setIssuingInvite(true);
    try {
      setInvite(await createInvite(group.id));
    } catch (error) {
      console.error(error);
      setErrorMessage(describeError(error) ?? "招待コードの発行に失敗しました");
    } finally {
      setIssuingInvite(false);
    }
  }

  async function handleShareInvite() {
    if (!invite) return;
    const text = `Mataneのグループに招待します。招待コード: ${invite.code}\n(24時間以内に入力してください)`;

    if (navigator.share) {
      try {
        await navigator.share({ title: "Mataneグループ招待", text });
      } catch (error) {
        // ユーザーが共有シートをキャンセルした場合のAbortErrorは無視する。
        if ((error as DOMException).name !== "AbortError") console.error(error);
      }
      return;
    }

    await navigator.clipboard.writeText(text);
    setShareCopied(true);
  }

  async function handleConfirmLeave() {
    setConfirmingLeave(false);
    setLeaving(true);
    setErrorMessage(null);
    try {
      await leaveGroup();
      setGroup(null);
      setMembers([]);
      setInvite(null);
      void pullFromCloud();
    } catch (error) {
      console.error(error);
      setErrorMessage("グループを抜ける処理に失敗しました");
    } finally {
      setLeaving(false);
    }
  }

  if (authLoading || loading) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 pt-8">
        <h1 className="text-lg font-bold">グループ設定</h1>
        <p className="text-sm text-neutral-600">
          グループ共有を使うにはログインが必要です。
        </p>
        <Link
          href="/login"
          className="rounded-full bg-amber-400 py-3 text-center text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400"
        >
          ログインする
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 pt-6">
      <header>
        <h1 className="text-lg font-bold">グループ設定</h1>
        <p className="mt-1 text-xs text-neutral-600">
          夫婦・家族単位でVisits・気になるリストを共有できます。
        </p>
      </header>

      {errorMessage && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{errorMessage}</p>
      )}

      {!group ? (
        <>
          <section className="flex flex-col gap-3 rounded-2xl bg-neutral-100 p-4">
            <h2 className="text-sm font-semibold text-neutral-600">グループを作る</h2>
            <p className="text-xs text-neutral-500">
              作成すると、あなたのVisits・気になるリストが今後グループメンバーと自動的に共有されます。
            </p>
            <button
              type="button"
              onClick={handleCreateGroup}
              disabled={creating}
              className="rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
            >
              {creating ? "作成中..." : "グループを作る"}
            </button>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl bg-neutral-100 p-4">
            <h2 className="text-sm font-semibold text-neutral-600">招待コードを持っている</h2>
            <input
              value={joinCodeInput}
              onChange={(event) => setJoinCodeInput(event.target.value)}
              placeholder="招待コードを入力"
              maxLength={16}
              className="rounded-xl bg-white px-4 py-3 text-base tracking-widest outline-none placeholder:text-neutral-400 placeholder:tracking-normal focus:ring-2 focus:ring-amber-400"
            />
            <button
              type="button"
              onClick={handleJoinGroup}
              disabled={joining || !joinCodeInput.trim()}
              className="rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
            >
              {joining ? "参加中..." : "参加する"}
            </button>
          </section>
        </>
      ) : (
        <>
          <section className="flex flex-col gap-3 rounded-2xl bg-neutral-100 p-4">
            <h2 className="text-sm font-semibold text-neutral-600">メンバー</h2>
            <ul className="flex flex-col gap-2">
              {members.map((member) => (
                <li
                  key={member.user_id}
                  className="flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm"
                >
                  <span>{member.email ?? "メンバー"}</span>
                  {member.user_id === session.user.id && (
                    <span className="text-xs text-amber-600">あなた</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl bg-neutral-100 p-4">
            <h2 className="text-sm font-semibold text-neutral-600">招待コード</h2>
            {invite ? (
              <>
                <p className="text-center text-2xl font-bold tracking-[0.3em]">{invite.code}</p>
                <p className="text-xs text-neutral-500">
                  24時間以内に入力すると参加できます(1回のみ使用可)。
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleShareInvite}
                    className="flex-1 rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400"
                  >
                    共有する
                  </button>
                  <button
                    type="button"
                    onClick={handleIssueInvite}
                    disabled={issuingInvite}
                    className="flex-1 rounded-full bg-neutral-200 py-3 text-sm font-semibold text-neutral-800 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
                  >
                    {issuingInvite ? "発行中..." : "新しく発行する"}
                  </button>
                </div>
                {shareCopied && (
                  <span className="text-center text-xs text-amber-600">コピーしました</span>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={handleIssueInvite}
                disabled={issuingInvite}
                className="rounded-full bg-amber-400 py-3 text-sm font-semibold text-black focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
              >
                {issuingInvite ? "発行中..." : "招待コードを発行する"}
              </button>
            )}
          </section>

          <button
            type="button"
            onClick={() => setConfirmingLeave(true)}
            disabled={leaving}
            className="rounded-full bg-neutral-200 py-3 text-sm font-semibold text-red-600 focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
          >
            {leaving ? "処理中..." : "グループを抜ける"}
          </button>
        </>
      )}

      <ConfirmDialog
        open={confirmingLeave}
        message="グループを抜けますか？実行後は相手の記録がすぐに見えなくなります。この操作は取り消せません。"
        confirmLabel="抜ける"
        onConfirm={handleConfirmLeave}
        onCancel={() => setConfirmingLeave(false)}
      />
    </main>
  );
}
