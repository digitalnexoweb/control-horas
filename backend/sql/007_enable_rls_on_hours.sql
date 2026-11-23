-- FIX DE SEGURIDAD: public.hours estaba sin RLS y era legible por cualquiera.
--
-- Como se detecto (23-11-2026, despues de reactivar el proyecto):
--   Una peticion ANONIMA, con solo la publishable key, devolvia las 104 filas
--   de la tabla (`content-range: 0-103/104`), de 2 usuarios distintos, con
--   user_id, fechas, horas trabajadas y dinero. El header `Allow` de
--   PostgREST ademas exponia POST, con lo que se podian inyectar registros.
--   Las otras tablas (profiles, user_sectors) devolvian [] correctamente.
--
-- Por que paso:
--   `hours` es la tabla principal de la app pero es la unica que NO tiene
--   migracion en backend/sql/. Fue creada a mano en el dashboard y nunca
--   recibio `enable row level security`, mientras que profiles (001) y
--   user_sectors (003) la tienen desde su propia migracion.
--   La publishable key esta en un repo PUBLICO y viaja a cada navegador,
--   asi que no es un secreto: lo unico que protege los datos es la RLS.
--
-- Por que esto NO rompe la app:
--   Todo acceso a `hours` pasa por el backend (functions/api/[[route]].js),
--   que crea el cliente con SUPABASE_SERVICE_ROLE_KEY, y la service_role
--   hace bypass de RLS. El frontend nunca consulta `hours` directo: usa
--   apiFetch() contra /add-hours, /update-hour, /delete-hour, /resumen,
--   /hours-by-month y /hours-by-calendar-month.
--   Las policies de abajo se agregan igual, por consistencia con las otras
--   tablas y para que una consulta directa futura funcione sin reabrir el
--   agujero: con `auth.uid() = user_id`, un anonimo (auth.uid() = null)
--   nunca matchea.
--
-- Idempotente: se puede correr mas de una vez sin problema.

alter table public.hours enable row level security;

drop policy if exists "hours_select_own" on public.hours;
create policy "hours_select_own"
on public.hours
for select
using (auth.uid() = user_id);

drop policy if exists "hours_insert_own" on public.hours;
create policy "hours_insert_own"
on public.hours
for insert
with check (auth.uid() = user_id);

drop policy if exists "hours_update_own" on public.hours;
create policy "hours_update_own"
on public.hours
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "hours_delete_own" on public.hours;
create policy "hours_delete_own"
on public.hours
for delete
using (auth.uid() = user_id);

-- Verificacion despues de aplicar (deberia devolver rowsecurity = true):
--   select relname, relrowsecurity as rowsecurity
--   from pg_class where relname = 'hours';
--
-- Y desde afuera, con la publishable key, esto tiene que devolver []:
--   curl -H "apikey: <publishable>" \
--     "https://<ref>.supabase.co/rest/v1/hours?select=id&limit=1"
