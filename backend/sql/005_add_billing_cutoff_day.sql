alter table public.profiles
  add column if not exists billing_cutoff_day integer;

update public.profiles
set billing_cutoff_day = 20
where billing_cutoff_day is null
   or billing_cutoff_day < 1
   or billing_cutoff_day > 31;

alter table public.profiles
  alter column billing_cutoff_day set default 20;

alter table public.profiles
  drop constraint if exists profiles_billing_cutoff_day_check;

alter table public.profiles
  add constraint profiles_billing_cutoff_day_check
  check (billing_cutoff_day between 1 and 31);
