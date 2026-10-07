-- Margia : colonnes de facturation (à exécuter une fois, après schema.sql)
alter table public.profiles add column if not exists stripe_customer_id text unique;
alter table public.profiles add column if not exists subscription_status text;
alter table public.profiles add column if not exists current_period_end timestamptz;
-- Ces colonnes ne sont modifiables que par le serveur (clé service), jamais par l'utilisateur :
-- les droits de mise à jour de "authenticated" restent limités aux réglages fiscaux (cf. schema.sql).
