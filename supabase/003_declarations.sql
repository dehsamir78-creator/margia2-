-- Margia : historique des déclarations URSSAF (à exécuter une fois, après schema.sql et 002_billing.sql)
create table if not exists public.declarations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2]|T[1-4])$'),
  revenue numeric(12,2) not null check (revenue >= 0),
  contributions numeric(12,2) not null check (contributions >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, period)
);
create index if not exists declarations_user_idx on public.declarations(user_id);

alter table public.declarations enable row level security;
create policy "decl: lecture perso" on public.declarations for select using (auth.uid() = user_id);
create policy "decl: ajout perso" on public.declarations for insert with check (auth.uid() = user_id);
create policy "decl: maj perso" on public.declarations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "decl: suppression perso" on public.declarations for delete using (auth.uid() = user_id);
