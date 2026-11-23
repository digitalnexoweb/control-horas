-- FIX 2: la 007 activo RLS en public.hours pero la tabla siguio abierta.
--
-- Verificado desde afuera despues de aplicar la 007: una peticion anonima
-- con solo la publishable key seguia devolviendo las 104 filas
-- (`content-range: 0-103/104`). RLS activa + tabla abierta = hay una policy
-- permisiva preexistente, del tipo `using (true)`, que la 007 no removio
-- porque solo hacia `drop policy if exists` de SUS propios nombres
-- (hours_select_own, hours_insert_own, hours_update_own, hours_delete_own).
--
-- Es el caso clasico de haber activado alguna vez en el dashboard un
-- "Enable read access for all users". Mientras RLS estuvo apagada esa policy
-- quedo inerte y no se noto; al activar RLS se desperto.
--
-- Esta migracion no adivina nombres: borra TODAS las policies de
-- public.hours y recrea solo las cuatro correctas. Idempotente.

-- 1) Asegurar RLS activa (por si la 007 no llego a aplicarse).
alter table public.hours enable row level security;

-- 2) Borrar toda policy existente en public.hours, cualquiera sea su nombre.
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'hours'
  loop
    raise notice 'Borrando policy preexistente en public.hours: %', p.policyname;
    execute format('drop policy %I on public.hours', p.policyname);
  end loop;
end $$;

-- 3) Recrear solo las policies correctas, por usuario dueño de la fila.
--    Un anonimo tiene auth.uid() = null, asi que nunca matchea.
create policy "hours_select_own"
on public.hours
for select
using (auth.uid() = user_id);

create policy "hours_insert_own"
on public.hours
for insert
with check (auth.uid() = user_id);

create policy "hours_update_own"
on public.hours
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "hours_delete_own"
on public.hours
for delete
using (auth.uid() = user_id);

-- 4) Verificacion. Esto se imprime al correr y deja ver el resultado real.
--    rls_activa debe ser true, y policies deben ser exactamente las 4 de arriba.
select relname as tabla, relrowsecurity as rls_activa
from pg_class
where oid = 'public.hours'::regclass;

select policyname, cmd, qual as using_expr, with_check
from pg_policies
where schemaname = 'public' and tablename = 'hours'
order by policyname;

-- Recordatorio: el backend usa SUPABASE_SERVICE_ROLE_KEY, que hace bypass de
-- RLS, asi que la app sigue funcionando igual. El frontend nunca consulta
-- `hours` directo (va por apiFetch contra /add-hours, /resumen, etc.).
