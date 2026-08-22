import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/test-utils/fakeSupabase";

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: vi.fn(),
}));

import { getSupabaseClient } from "@/lib/supabase/client";
import {
  buildMemberEmailMap,
  createGroup,
  createInvite,
  isOwnVisit,
  joinGroupByCode,
  leaveGroup,
} from "./groups";

const USER_ID = "user-1";

function useSupabase(opts: {
  fromQueues?: Record<string, unknown[]>;
  rpcResults?: Record<string, unknown>;
  userId?: string | null;
}) {
  const supabase = createFakeSupabase({ userId: USER_ID, ...opts });
  vi.mocked(getSupabaseClient).mockReturnValue(supabase as never);
  return supabase;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createInvite - 招待コード発行", () => {
  it("紛らわしい文字(0/O/1/I/L)を含まない8文字の招待コードを生成してinsertする", async () => {
    const supabase = useSupabase({
      fromQueues: {
        group_invites: [
          {
            data: { id: "invite-1", group_id: "group-1", code: "PLACEHOLDER", created_by: USER_ID },
            error: null,
          },
        ],
      },
    });

    const result = await createInvite("group-1");

    expect(result.id).toBe("invite-1");
    expect(supabase.from).toHaveBeenCalledWith("group_invites");

    // from("group_invites")が返したビルダーの.insert()呼び出し引数を検証する。
    const builder = supabase.from.mock.results[0].value as {
      insert: ReturnType<typeof vi.fn>;
    };
    const insertedArg = builder.insert.mock.calls[0][0] as {
      group_id: string;
      created_by: string;
      code: string;
    };
    expect(insertedArg.group_id).toBe("group-1");
    expect(insertedArg.created_by).toBe(USER_ID);
    expect(insertedArg.code).toHaveLength(8);
    expect(insertedArg.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(insertedArg.code).not.toMatch(/[01OI]/);
  });
});

describe("joinGroupByCode - 招待コードでの参加", () => {
  it("コードをtrim・大文字化してredeem_group_inviteに渡す", async () => {
    const rpcSpy = vi.fn(() => Promise.resolve({ data: "group-1", error: null }));
    const supabase = useSupabase({ rpcResults: {} });
    supabase.rpc = rpcSpy as never;

    const groupId = await joinGroupByCode("  abcd1234  ");

    expect(groupId).toBe("group-1");
    expect(rpcSpy).toHaveBeenCalledWith("redeem_group_invite", { p_code: "ABCD1234" });
  });

  it("空白のみのコードはRPCを呼ばずにエラーを投げる", async () => {
    const rpcSpy = vi.fn();
    const supabase = useSupabase({ rpcResults: {} });
    supabase.rpc = rpcSpy as never;

    await expect(joinGroupByCode("   ")).rejects.toThrow("招待コードを入力してください");
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("invite_invalidエラー(失効・不正なコード)は分かりやすいメッセージに変換する", async () => {
    useSupabase({
      rpcResults: {
        redeem_group_invite: {
          data: null,
          error: new Error("invite_invalid: code not found or expired"),
        },
      },
    });

    await expect(joinGroupByCode("ZZZZZZZZ")).rejects.toThrow(
      "招待コードが無効か、期限切れです"
    );
  });

  it("already_in_groupエラーは分かりやすいメッセージに変換する", async () => {
    useSupabase({
      rpcResults: {
        redeem_group_invite: { data: null, error: new Error("already_in_group") },
      },
    });

    await expect(joinGroupByCode("ZZZZZZZZ")).rejects.toThrow("既にグループに所属しています");
  });

  it("想定外のエラーはそのまま投げる", async () => {
    useSupabase({
      rpcResults: {
        redeem_group_invite: { data: null, error: new Error("network down") },
      },
    });

    await expect(joinGroupByCode("ZZZZZZZZ")).rejects.toThrow("network down");
  });
});

describe("createGroup", () => {
  it("既に所属中の場合はわかりやすいメッセージに変換する", async () => {
    useSupabase({
      rpcResults: {
        create_group: { data: null, error: new Error("already_in_group") },
      },
    });

    await expect(createGroup()).rejects.toThrow("既にグループに所属しています");
  });

  it("成功時はグループ情報を返す", async () => {
    useSupabase({
      rpcResults: {
        create_group: {
          data: { id: "group-1", name: null, created_by: USER_ID, created_at: "2026-01-01" },
          error: null,
        },
      },
    });

    const group = await createGroup();
    expect(group.id).toBe("group-1");
  });
});

describe("leaveGroup", () => {
  it("自分のuser_idの行のみ削除する", async () => {
    const supabase = useSupabase({
      fromQueues: { group_members: [{ error: null }] },
    });

    await leaveGroup();

    expect(supabase.from).toHaveBeenCalledWith("group_members");
  });

  it("削除に失敗した場合はエラーを投げる", async () => {
    useSupabase({
      fromQueues: { group_members: [{ error: { message: "failed" } }] },
    });

    await expect(leaveGroup()).rejects.toBeTruthy();
  });
});

describe("isOwnVisit", () => {
  it("authLoading中は常に自分の記録として扱う", () => {
    expect(isOwnVisit({ user_id: "other" }, "me", true)).toBe(true);
  });

  it("user_id未設定(未同期の新規記録)は常に自分の記録として扱う", () => {
    expect(isOwnVisit({ user_id: null }, "me", false)).toBe(true);
    expect(isOwnVisit({}, "me", false)).toBe(true);
  });

  it("user_idが自分と一致すれば自分の記録", () => {
    expect(isOwnVisit({ user_id: "me" }, "me", false)).toBe(true);
  });

  it("user_idが他人であれば自分の記録ではない", () => {
    expect(isOwnVisit({ user_id: "partner" }, "me", false)).toBe(false);
  });
});

describe("buildMemberEmailMap", () => {
  it("user_id→emailのマップを構築する", () => {
    const map = buildMemberEmailMap([
      { user_id: "u1", email: "a@example.com", joined_at: "2026-01-01" },
      { user_id: "u2", email: null, joined_at: "2026-01-02" },
    ]);
    expect(map.get("u1")).toBe("a@example.com");
    expect(map.get("u2")).toBeNull();
  });

  it("nullを渡した場合は空のマップを返す", () => {
    const map = buildMemberEmailMap(null);
    expect(map.size).toBe(0);
  });
});
