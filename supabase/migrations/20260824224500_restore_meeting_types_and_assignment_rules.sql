-- Restore the distinction between user-created personal meetings and
-- program-created official meetings, and expose a safe company directory for
-- HR/manager assignment without widening full-profile RLS visibility.

create or replace function public.k_assignment_directory()
returns table(
  id uuid,
  full_name text,
  job_title text,
  department text,
  is_hr boolean,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_is_hr boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Необходима авторизация';
  end if;

  select actor.is_hr into actor_is_hr
  from public.k_profiles actor
  where actor.id=(select auth.uid()) and actor.is_active;
  if not found then raise exception 'Профиль не найден или неактивен'; end if;
  if not actor_is_hr then return; end if;

  return query
  select p.id,p.full_name,p.job_title,p.department,p.is_hr,p.is_active
  from public.k_profiles p
  where p.is_active
  order by p.full_name;
end
$$;

revoke all on function public.k_assignment_directory() from public, anon;
grant execute on function public.k_assignment_directory() to authenticated;

create or replace function private.k_guard_profile_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    if current_user in ('postgres', 'supabase_admin', 'service_role') then
      new.updated_at = now();
      return new;
    end if;
    raise exception 'Необходима авторизация';
  end if;

  if (select auth.uid()) = old.id and not private.k_actor_is_admin() then
    if (to_jsonb(new) - array['telegram_url','updated_at'])
       is distinct from
       (to_jsonb(old) - array['telegram_url','updated_at']) then
      raise exception 'В своём профиле можно изменить только Telegram';
    end if;
  end if;

  if not private.k_actor_is_admin()
     and (new.is_hr is distinct from old.is_hr
          or new.is_head_hr is distinct from old.is_head_hr) then
    raise exception 'Назначать HR и администратора может только главный администратор';
  end if;

  if new.hr_id is not null and not exists (
    select 1 from public.k_profiles p
    where p.id=new.hr_id and p.is_hr and p.is_active
  ) then
    raise exception 'Назначенный HR должен быть активным HR';
  end if;

  if new.manager_id is not null and not exists (
    select 1 from public.k_profiles p
    where p.id=new.manager_id and p.is_active
  ) then
    raise exception 'Руководитель должен быть активным сотрудником';
  end if;

  new.updated_at = now();
  return new;
end
$$;

update public.k_meetings
set meeting_type='first_month'
where title='Итоги первого месяца Олега'
  and meeting_type='personal';
