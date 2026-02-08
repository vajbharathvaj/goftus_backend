create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  product text not null,
  message text not null,
  href text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists banners_active_idx on public.banners (is_active);

create or replace function public.set_banners_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_banners_updated_at on public.banners;
create trigger set_banners_updated_at
before update on public.banners
for each row
execute function public.set_banners_updated_at();
