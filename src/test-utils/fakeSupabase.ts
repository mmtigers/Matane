import { vi } from "vitest";

// supabase-js のクエリビルダは各メソッドがチェーン可能かつ、チェーンの終端で
// await するとPromiseとして解決する(thenable)。テストではチェーンの形自体は
// 検証しないため、どのメソッドが呼ばれても自分自身を返し、最終的にawaitされた
// 時点でキューから取り出した結果を返すだけの簡易ビルダーで代用する。
function makeQueryBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const chainMethods = [
    "select",
    "eq",
    "neq",
    "limit",
    "gt",
    "lt",
    "gte",
    "lte",
    "is",
    "order",
    "in",
    "upsert",
    "insert",
    "delete",
    "single",
    "maybeSingle",
  ];
  for (const method of chainMethods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

interface FakeSupabaseOptions {
  userId?: string | null;
  // テーブル名 → そのテーブルへの`.from()`呼び出し順に返す結果のキュー。
  fromQueues?: Record<string, unknown[]>;
  // RPC関数名 → 結果(関数の場合は呼び出し引数を受け取り結果を返す)。
  rpcResults?: Record<string, unknown | ((args: unknown) => unknown)>;
}

export function createFakeSupabase(opts: FakeSupabaseOptions = {}) {
  const fromQueues = opts.fromQueues ?? {};
  const rpcResults = opts.rpcResults ?? {};
  const fromCalls: string[] = [];

  const from = vi.fn((table: string) => {
    fromCalls.push(table);
    const queue = fromQueues[table];
    if (!queue || queue.length === 0) {
      throw new Error(`fakeSupabase: no queued response left for table "${table}"`);
    }
    return makeQueryBuilder(queue.shift());
  });

  const rpc = vi.fn((name: string, args?: unknown) => {
    if (!(name in rpcResults)) {
      throw new Error(`fakeSupabase: no rpc result configured for "${name}"`);
    }
    const entry = rpcResults[name];
    const result = typeof entry === "function" ? (entry as (a: unknown) => unknown)(args) : entry;
    return Promise.resolve(result);
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: opts.userId ? { id: opts.userId } : null },
      }),
    },
    from,
    rpc,
    fromCalls,
  };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
