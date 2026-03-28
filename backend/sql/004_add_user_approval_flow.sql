alter table public.profiles
add column if not exists approval_status text not null default 'approved';

alter table public.profiles
add column if not exists approval_requested_at timestamptz;

alter table public.profiles
add column if not exists approved_at timestamptz;

alter table public.profiles
add column if not exists approved_by_email text;

alter table public.profiles
add column if not exists approval_token uuid;

update public.profiles
set approval_status = 'approved'
where approval_status is null;

update public.profiles
set approved_at = coalesce(approved_at, now())
where approval_status = 'approved' and approved_at is null;

create unique index if not exists profiles_approval_token_key
on public.profiles (approval_token)
where approval_token is not null;
