-- Matane: Venues / Visits schema
-- PRD section 4 に基づく2レイヤー構造 (Venues=店舗マスタ, Visits=訪問履歴)

create extension if not exists "uuid-ossp";
create extension if not exists postgis;

create table if not exists venues (
  id uuid primary key default uuid_generate_v4(),
  place_id text unique,
  name text not null check (char_length(name) <= 100),
  location geography(point, 4326),
  address text,
  nearest_station text,
  is_wished boolean not null default false,
  -- bar: 仕事での使用がメインの飲み屋。family: 家族での使用がメインのご飯屋・公園・スーパー等。
  category text not null default 'bar' check (category in ('bar', 'family')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 既存環境向けマイグレーション: is_wished/category列が無い場合のみ追加する(新規作成時は
-- 上のcreate table if not existsで既に含まれているため実質no-op)。
alter table venues add column if not exists is_wished boolean not null default false;
alter table venues add column if not exists category text not null default 'bar';

-- 「行きたい理由」タグ(例: おいしそう、楽しそう)。venuesは全ユーザー共有マスタなので
-- is_wishedと同様にVenue側に持たせる。既存環境向けマイグレーション。
alter table venues add column if not exists wish_reason text[];

create table if not exists visits (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  venue_id uuid not null references venues(id) on delete cascade,
  visited_at timestamptz not null default now(),
  is_completed boolean not null default false,
  who text[] not null default '{}',
  revisit text,
  budget text,
  alcohol_tags text[] not null default '{}',
  quietness text,
  -- 写真本体はSupabase Storageの visit-photos バケットに保存し、ここにはURLのみを
  -- 持たせる(一覧クエリがbase64画像ごと転送するのを防ぐため)。
  best_photo text,
  memo text check (memo is null or char_length(memo) <= 2000),
  ai_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_visits_user_id on visits(user_id);
create index if not exists idx_visits_venue_id on visits(venue_id);
create index if not exists idx_visits_visited_at on visits(visited_at desc);
create index if not exists idx_visits_is_completed on visits(is_completed) where is_completed = false;

-- 場所データのグループ共有機能 (docs/REQUIREMENTS_group_sharing.md 4章)。
-- 夫婦・家族単位でVisits/Venuesを共有する単位。1ユーザーは同時に1グループのみ所属可能
-- (group_members.user_idのunique制約で担保。将来3人以上の家族拡張を見越しN人グループとして設計)。
create table if not exists groups (
  id uuid primary key default uuid_generate_v4(),
  name text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists group_members (
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade unique,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- 招待コードは発行から24時間で失効・1回限り使用(used_atが入っていたら再利用不可)。
create table if not exists group_invites (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  code text not null unique,
  created_by uuid references auth.users(id),
  -- クライアントに委ねずDB側で24時間後をデフォルト算出する(下のINSERTポリシーの
  -- with checkでも上限を強制し、クライアントが明示的にexpires_atを指定して
  -- 24時間を超える有効期限を偽装できないようにする)。
  expires_at timestamptz not null default (now() + interval '24 hours'),
  used_at timestamptz,
  used_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_group_members_group_id on group_members(group_id);
create index if not exists idx_group_invites_group_id on group_invites(group_id);

alter table venues enable row level security;
alter table visits enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table group_invites enable row level security;

-- groups: 自グループのメンバーのみ参照可。created_by = 自分も常に参照可としているのは、
-- 作成直後(まだgroup_membersに自分を追加する前)のinsert...select()で作成した行を
-- 読み返せるようにするため(RLSはINSERT ... RETURNINGにもSELECTポリシーを適用するため)。
create policy "groups are readable by members"
  on groups for select
  to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from group_members gm
      where gm.group_id = groups.id and gm.user_id = auth.uid()
    )
  );

create policy "groups are insertable by their creator"
  on groups for insert
  to authenticated
  with check (created_by = auth.uid());

-- groups のUPDATEポリシーは現状意図的に用意していない(=デフォルト拒否)。
-- 「メンバーなら更新可」だけをusingにしwith checkを省略すると(=usingがwith checkにも
-- 使われる)、created_byを任意の他ユーザーIDへ書き換えられてしまい、SELECTポリシーの
-- 「created_by = auth.uid()」経由でそのユーザーにgroups行(name等)を覗き見させられる
-- 抜け道になるため、現状のUIで使わない以上は追加しない。

-- group_members: 自分の所属グループのメンバー一覧を閲覧可能。
create policy "group_members are readable by fellow members"
  on group_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from group_members gm_self
      where gm_self.group_id = group_members.group_id and gm_self.user_id = auth.uid()
    )
  );

-- 招待コード経由の参加はredeem_group_invite() (SECURITY DEFINER、下記)のみで許可し、
-- 直接のINSERTは「自分が作成したグループに自分自身を追加する」場合のみに限定する。
-- これを一般的な自己参加(user_id = auth.uid()のみ)にすると、招待コードを知らなくても
-- group_idさえ分かれば誰でも他人のグループに参加できてしまうため。user_id側のunique
-- 制約と合わせ、このポリシーは実質「グループ作成者が自分自身を最初のメンバーとして
-- 追加する」1回限りの操作にしかなり得ない(他人をuser_idに指定することはできず、
-- 既に何らかのグループに所属済みなら2回目のinsertはunique制約で弾かれるため)。
create policy "group_members are insertable by the founding creator"
  on group_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from groups g
      where g.id = group_members.group_id and g.created_by = auth.uid()
    )
  );

-- グループを抜ける操作。本人の行のみ削除可能。
create policy "group_members are deletable by themselves"
  on group_members for delete
  to authenticated
  using (user_id = auth.uid());

-- group_invites: 自グループのメンバーのみ閲覧・発行可能。招待コードの照合・消費は
-- (未所属ユーザーからも呼べる必要があるため)RLSではなくredeem_group_invite()で行う。
create policy "group_invites are readable by group members"
  on group_invites for select
  to authenticated
  using (
    exists (
      select 1 from group_members gm
      where gm.group_id = group_invites.group_id and gm.user_id = auth.uid()
    )
  );

create policy "group_invites are insertable by group members"
  on group_invites for insert
  to authenticated
  with check (
    created_by = auth.uid()
    -- expires_atのデフォルト値はクライアントが明示的に値を指定すると上書きされて
    -- しまうため、ここでも「発行から24時間+時計ずれ許容5分」を超えられないよう
    -- サーバー側で二重に強制する(悪意あるクライアントが無期限に近い招待コードを
    -- 発行することを防ぐ)。
    and expires_at <= now() + interval '24 hours' + interval '5 minutes'
    and exists (
      select 1 from group_members gm
      where gm.group_id = group_invites.group_id and gm.user_id = auth.uid()
    )
  );

-- 招待コードの照合・消費(group_membersへの参加行追加 + group_invites.used_at更新)を
-- 1つのトランザクションで行うSECURITY DEFINER関数。未所属ユーザーがコードの中身を
-- 知らないまま招待コード一覧を走査できてしまう(group_invitesへの広いselect権限)事態を
-- 避けるため、参加フローはテーブルへの直接書き込みではなくこの関数経由に限定する。
create or replace function redeem_group_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite group_invites%rowtype;
begin
  select * into v_invite
  from group_invites
  where code = p_code
    and used_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'invite_invalid';
  end if;

  if exists (select 1 from group_members where user_id = auth.uid()) then
    raise exception 'already_in_group';
  end if;

  insert into group_members (group_id, user_id) values (v_invite.group_id, auth.uid());

  update group_invites
  set used_at = now(), used_by = auth.uid()
  where id = v_invite.id;

  return v_invite.group_id;
end;
$$;

grant execute on function redeem_group_invite(text) to authenticated;

-- グループメンバー一覧画面用。auth.usersのemailはクライアントから直接参照できないため、
-- 自分の所属グループのメンバーに限定してemailを返すSECURITY DEFINER関数を用意する。
create or replace function get_group_members()
returns table (user_id uuid, email text, joined_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select gm.user_id, u.email::text, gm.joined_at
  from group_members gm
  join auth.users u on u.id = gm.user_id
  where gm.group_id = (
    select group_id from group_members where user_id = auth.uid()
  )
  order by gm.joined_at asc;
$$;

grant execute on function get_group_members() to authenticated;

-- Venues は「作成者と同じグループのメンバー」にのみ公開する共有マスタ。作成者が
-- 未所属(グループなし)の場合は本人のみが読み書きできる状態を維持する
-- (docs/REQUIREMENTS_group_sharing.md 4章)。書き込みは認証済みユーザーのみだが、
-- created_by を必須にして「誰が作成したか」を追跡できるようにする。
-- 既存環境向けマイグレーション: 旧ポリシー(全ユーザーに開放)が残っていれば削除する。
drop policy if exists "venues are readable by authenticated users" on venues;
drop policy if exists "venues are updatable by authenticated users" on venues;
drop policy if exists "venues are updatable by their creator" on venues;

create policy "venues are readable by creator or group members"
  on venues for select
  to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1
      from group_members gm_self
      join group_members gm_owner on gm_owner.group_id = gm_self.group_id
      where gm_self.user_id = auth.uid()
        and gm_owner.user_id = venues.created_by
    )
  );

create policy "venues are insertable by authenticated users"
  on venues for insert
  to authenticated
  with check (created_by = auth.uid());

-- 同じ実店舗(同じGoogle place_id)にグループ内の別メンバーが後からチェックインして
-- Venueを再利用するケースがあるため、updateもselectと同じ範囲(作成者+同じグループ)に
-- 開放する(そうしないと作成者以外が店名修正や「行きたい」トグルをした際にRLSで弾かれ、
-- syncStatusが永久にpendingのまま残ってしまう)。with checkはusingと同じ条件にし、
-- with check(true)にはしない: trueにすると悪意あるメンバーがcreated_byを
-- グループ外の第三者IDへ書き換えられてしまい(venues.created_by=そのユーザーIDにより
-- Venueがグループの可視範囲外へ実質的に持ち出される/汚染される)、usingと揃えることで
-- created_byの書き換え先も「自分または同じグループのメンバー」の範囲に閉じる。
create policy "venues are updatable by creator or group members"
  on venues for update
  to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1
      from group_members gm_self
      join group_members gm_owner on gm_owner.group_id = gm_self.group_id
      where gm_self.user_id = auth.uid()
        and gm_owner.user_id = venues.created_by
    )
  )
  with check (
    created_by = auth.uid()
    or exists (
      select 1
      from group_members gm_self
      join group_members gm_owner on gm_owner.group_id = gm_self.group_id
      where gm_self.user_id = auth.uid()
        and gm_owner.user_id = venues.created_by
    )
  );

-- Visits は本人 + 同じグループのメンバーのVisitsを閲覧可能。編集・削除は本人のみ。
-- 既存環境向けマイグレーション: 旧ポリシー(本人のみ)が残っていれば削除する。
drop policy if exists "visits are readable by owner" on visits;

create policy "visits are readable by owner or group members"
  on visits for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from group_members gm_self
      join group_members gm_owner on gm_owner.group_id = gm_self.group_id
      where gm_self.user_id = auth.uid()
        and gm_owner.user_id = visits.user_id
    )
  );

create policy "visits are insertable by owner"
  on visits for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "visits are updatable by owner"
  on visits for update
  to authenticated
  using (auth.uid() = user_id);

create policy "visits are deletable by owner"
  on visits for delete
  to authenticated
  using (auth.uid() = user_id);

-- 「厳選の1枚」写真の保存先。パスは `${userId}/${visitId}.jpg` 形式を前提とし、
-- 先頭フォルダ名をauth.uid()と突き合わせて所有者以外の読み書きを防ぐ
-- (bucketはpublic=trueのため読み取り自体は誰でも可能。友人と写真を共有する
-- Phase4のシナリオを見越した設計)。
insert into storage.buckets (id, name, public)
values ('visit-photos', 'visit-photos', true)
on conflict (id) do nothing;

create policy "visit-photos are readable by anyone"
  on storage.objects for select
  using (bucket_id = 'visit-photos');

create policy "visit-photos are uploadable by their owner"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "visit-photos are updatable by their owner"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "visit-photos are deletable by their owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
