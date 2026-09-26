-- napkin 동기화 테이블. Supabase › SQL Editor 에 붙여넣고 Run.
-- 메모 · 할 일 · 분류 설정을 한 테이블에 담는다. 본인 데이터만 읽고 쓸 수 있다.

create table if not exists public.items (
  user_id    uuid    not null default auth.uid() references auth.users on delete cascade,
  kind       text    not null check (kind in ('memo', 'todo', 'meta')),
  id         text    not null,
  data       jsonb,
  updated_at bigint  not null,              -- 기기에서 바뀐 시각(ms). 더 최근 것이 이긴다
  deleted    boolean not null default false,
  synced_at  timestamptz not null default now(),  -- 서버에 들어온 시각. 받아갈 때 기준
  primary key (user_id, kind, id)
);

create index if not exists items_user_synced on public.items (user_id, synced_at);

-- 올릴 때마다 서버 시각을 새로 찍는다
create or replace function public.items_touch() returns trigger
language plpgsql as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
for each row execute function public.items_touch();

-- 본인 것만
alter table public.items enable row level security;
drop policy if exists "own items" on public.items;
create policy "own items" on public.items
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
