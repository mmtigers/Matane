-- Matane: Venues / Visits schema
-- PRD section 4 に基づく2レイヤー構造 (Venues=店舗マスタ, Visits=訪問履歴)

create extension if not exists "uuid-ossp";

create table if not exists venues (
  id uuid primary key default uuid_generate_v4(),
  place_id text unique,
  name text not null,
  location geography(point, 4326),
  address text,
  nearest_station text,
  created_at timestamptz not null default now()
);

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
  best_photo text,
  memo text,
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

-- Venues はプレイス情報のマスタなので全ユーザー参照可、書き込みは認証済みユーザーのみ
create policy "venues are readable by authenticated users"
  on venues for select
  to authenticated
  using (true);

create policy "venues are insertable by authenticated users"
  on venues for insert
  to authenticated
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
