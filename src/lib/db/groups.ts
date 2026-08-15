import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { Group, GroupInvite, GroupMemberProfile } from "@/types/models";

// 紛らわしい文字(0/O, 1/I/L)を除いた招待コード用アルファベット。手入力・音声共有を想定。
const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LENGTH = 8;
const INVITE_EXPIRES_MS = 1000 * 60 * 60 * 24;

function generateInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => INVITE_CODE_ALPHABET[b % INVITE_CODE_ALPHABET.length]).join("");
}

async function requireUserId(): Promise<string> {
  const { data } = await getSupabaseClient().auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("ログインが必要です");
  return userId;
}

// 未所属の場合はnullを返す(1ユーザー1グループのため、所属していれば必ず1件)。
export async function getMyGroup(): Promise<Group | null> {
  const supabase = getSupabaseClient();
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("group_members")
    .select("groups(id, name, created_by, created_at)")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;

  const row = data?.groups as Group | Group[] | null | undefined;
  if (!row) return null;
  return Array.isArray(row) ? (row[0] ?? null) : row;
}

// グループを新規作成し、作成者自身を最初のメンバーとして追加する。
export async function createGroup(): Promise<Group> {
  const supabase = getSupabaseClient();
  const userId = await requireUserId();

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .insert({ created_by: userId })
    .select()
    .single();
  if (groupError) throw groupError;

  const { error: memberError } = await supabase
    .from("group_members")
    .insert({ group_id: group.id, user_id: userId });
  if (memberError) throw memberError;

  return group as Group;
}

// 既存の未使用・期限内の招待コードがあれば返す(設定画面での併記用)。
export async function getActiveInvite(groupId: string): Promise<GroupInvite | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("group_invites")
    .select("*")
    .eq("group_id", groupId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as GroupInvite | null) ?? null;
}

// 新しい招待コードを発行する(24時間後に失効)。既存メンバーなら誰でも発行可能。
export async function createInvite(groupId: string): Promise<GroupInvite> {
  const supabase = getSupabaseClient();
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from("group_invites")
    .insert({
      group_id: groupId,
      code: generateInviteCode(),
      created_by: userId,
      expires_at: new Date(Date.now() + INVITE_EXPIRES_MS).toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data as GroupInvite;
}

// 招待コードでの参加。コードの照合・消費(group_invites.used_at更新)と
// group_membersへの追加はredeem_group_invite() (SECURITY DEFINER)側で
// アトミックに行う(招待コード一覧をクライアントから走査できないようにするため)。
export async function joinGroupByCode(code: string): Promise<string> {
  const supabase = getSupabaseClient();
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) throw new Error("招待コードを入力してください");

  const { data, error } = await supabase.rpc("redeem_group_invite", { p_code: trimmed });
  if (error) {
    if (error.message?.includes("invite_invalid")) {
      throw new Error("招待コードが無効か、期限切れです");
    }
    if (error.message?.includes("already_in_group")) {
      throw new Error("既にグループに所属しています");
    }
    throw error;
  }
  return data as string;
}

// グループを抜ける。自分の行のみ削除するため相手側のグループには影響しない。
export async function leaveGroup(): Promise<void> {
  const supabase = getSupabaseClient();
  const userId = await requireUserId();
  const { error } = await supabase.from("group_members").delete().eq("user_id", userId);
  if (error) throw error;
}

// メンバー一覧(email表示用)。auth.usersに直接アクセスできないため
// SECURITY DEFINER関数(get_group_members)経由で取得する。
export async function getGroupMembers(): Promise<GroupMemberProfile[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("get_group_members");
  if (error) throw error;
  return (data ?? []) as GroupMemberProfile[];
}

// タイムライン・店舗詳細で「誰の記録か」を表示するための軽量フック。
// グループに所属していない場合は空配列を返す(RPCがRLS経由で自然に0件になる)。
export function useGroupMembers(): GroupMemberProfile[] | null {
  const [members, setMembers] = useState<GroupMemberProfile[] | null>(null);

  useEffect(() => {
    let active = true;
    getGroupMembers()
      .then((data) => {
        if (active) setMembers(data);
      })
      .catch(() => {
        if (active) setMembers([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return members;
}

// user_id未設定(=クラウド未同期の自分の新規記録)は常に自分の記録として扱う。
export function isOwnVisit(
  visit: { user_id?: string | null },
  currentUserId: string | null | undefined
): boolean {
  return !visit.user_id || visit.user_id === currentUserId;
}

// タイムライン・店舗詳細でuser_id→emailを引くための軽量マップ。
export function buildMemberEmailMap(
  members: GroupMemberProfile[] | null
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const member of members ?? []) map.set(member.user_id, member.email);
  return map;
}
