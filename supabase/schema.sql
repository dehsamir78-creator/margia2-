-- Margia : schéma de base. À exécuter une fois dans Supabase > SQL Editor.

-- Profils (un par utilisateur)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  vat_registered boolean not null default false,
  liberatoire boolean not null default false,
  urssaf_rate numeric(5,2) not null default 12.3,
  cfp_rate numeric(5,2) not null default 0.1,
  plan text not null default 'free' check (plan in ('free','pro')),
  created_at timestamptz not null default now()
);

-- Produits suivis
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  price numeric(10,2) not null check (price >= 0),
  cogs numeric(10,2) not null default 0 check (cogs >= 0),
  cpa numeric(10,2) not null default 0 check (cpa >= 0),
  refund_rate numeric(5,2) not null default 0 check (refund_rate between 0 and 100),
  pay_pct numeric(5,2) not null default 1.8 check (pay_pct between 0 and 100),
  pay_fixed numeric(10,2) not null default 0.25 check (pay_fixed >= 0),
  fixed_monthly numeric(10,2) not null default 0 check (fixed_monthly >= 0),
  orders_monthly integer not null default 0 check (orders_monthly >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_user_idx on public.products(user_id);

-- Événements analytics (funnel)
create table if not exists public.events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) <= 60),
  created_at timestamptz not null default now()
);

-- Sécurité : chaque utilisateur ne voit que ses données
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.events enable row level security;

create policy "profil: lecture perso" on public.profiles for select using (auth.uid() = id);
create policy "profil: maj perso" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
-- Le plan ne peut être modifié que côté serveur (webhook Stripe), jamais par l'utilisateur
revoke update on public.profiles from authenticated, anon;
grant update (vat_registered, liberatoire, urssaf_rate, cfp_rate) on public.profiles to authenticated;

create policy "produits: lecture perso" on public.products for select using (auth.uid() = user_id);
create policy "produits: ajout perso" on public.products for insert with check (auth.uid() = user_id);
create policy "produits: maj perso" on public.products for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "produits: suppression perso" on public.products for delete using (auth.uid() = user_id);

create policy "events: ajout perso" on public.events for insert with check (auth.uid() = user_id);

-- Limite du plan gratuit : 3 produits
create or replace function public.enforce_free_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select plan from public.profiles where id = new.user_id) = 'free'
     and (select count(*) from public.products where user_id = new.user_id) >= 3 then
    raise exception 'LIMITE_GRATUITE';
  end if;
  return new;
end $$;
drop trigger if exists products_free_limit on public.products;
create trigger products_free_limit before insert on public.products
  for each row execute function public.enforce_free_limit();

-- Création automatique du profil à l'inscription
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
