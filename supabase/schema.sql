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
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 既存環境向けマイグレーション: is_wished列が無い場合のみ追加する(新規作成時は
-- 上のcreate table if not existsで既に含まれているため実質no-op)。
alter table venues add column if not exists is_wished boolean not null default false;

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

alter table venues enable row level security;
alter table visits enable row level security;

-- Venues はプレイス情報のマスタなので全ユーザー参照可。書き込みは認証済みユーザーのみだが、
-- created_by を必須にして「誰が作成したか」を追跡できるようにする(全ユーザーが無制限に
-- 書き込める状態だと、公開されたマジックリンク登録経路から共有venuesテーブルを
-- 汚染される懸念があるため)。
create policy "venues are readable by authenticated users"
  on venues for select
  to authenticated
  using (true);

create policy "venues are insertable by authenticated users"
  on venues for insert
  to authenticated
  with check (created_by = auth.uid());

-- 既存環境向けマイグレーション: 旧ポリシー(作成者のみ更新可)が残っていれば削除する
-- (新規作成時は元々存在しないため実質no-op)。
drop policy if exists "venues are updatable by their creator" on venues;

-- venuesは全認証ユーザーが参照可能な共有マスタ(上のselectポリシー参照)であり、
-- 同じ実店舗(同じGoogle place_id)に別ユーザーが後からチェックインしてVenueを
-- 再利用するケースがある。updateをcreated_by=auth.uid()に限定すると、作成者以外の
-- ユーザーが店名修正や「行きたい」トグルをした際にRLSで弾かれ、syncStatusが
-- 永久にpendingのまま残ってしまう(selectの開放性とupdateの制限が矛盾していた)。
-- そのためupdateもselectと同様に全認証ユーザーに開放する。
create policy "venues are updatable by authenticated users"
  on venues for update
  to authenticated
  using (true)
  with check (true);

-- Visits は本人のデータのみ読み書き可能
create policy "visits are readable by owner"
  on visits for select
  to authenticated
  using (auth.uid() = user_id);

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
