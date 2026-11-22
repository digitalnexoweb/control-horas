-- Tabla de actividad para el keep-alive del plan free de Supabase.
--
-- Esta tabla ya existia en la base pero su SQL nunca estuvo versionado:
-- `keep_alive` solo aparecia dentro del workflow de GitHub Actions, que
-- referenciaba un SQL inexistente ("ver SQL en el repo / README").
-- Queda versionada aca para que se pueda recrear el proyecto de cero.
--
-- Quien escribe: el Worker `keep-alive/` (Cron Trigger de Cloudflare), con la
-- service_role key. RLS queda habilitada y SIN politicas a proposito: la
-- service_role key hace bypass de RLS, y ningun usuario final necesita
-- tocar esta tabla.

create extension if not exists pgcrypto;

create table if not exists public.keep_alive (
  id uuid primary key default gen_random_uuid(),
  pinged_at timestamptz not null default now()
);

create index if not exists keep_alive_pinged_at_idx
  on public.keep_alive (pinged_at desc);

alter table public.keep_alive enable row level security;

-- Sin politicas: solo la service_role (que ignora RLS) escribe aca.
-- Si en algun momento se quiere leer desde el frontend, agregar una policy
-- de select explicita; hoy no hace falta.

-- Purga para que la tabla no crezca sin limite (un ping por dia es poco,
-- pero esto la mantiene prolija). Correr cuando se quiera, es idempotente.
delete from public.keep_alive
where pinged_at < now() - interval '90 days';
