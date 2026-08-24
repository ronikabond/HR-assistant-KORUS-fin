-- Security and consistency follow-up for the reviewed production prototype.
-- The public RPCs below keep compound writes in one database transaction.

-- ---------------------------------------------------------------------------
-- Profile visibility and role protection
-- ---------------------------------------------------------------------------

create or replace function private.k_can_read_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.k_profiles p
    where p.id = target
      and p.is_active
      and (
        private.k_actor_is_admin()
        or (p.id <> (select auth.uid()) and p.hr_id = (select auth.uid()))
        or (p.id <> (select auth.uid()) and p.manager_id = (select auth.uid()))
      )
  )
$$;

revoke all on function private.k_can_read_profile(uuid) from public;
grant execute on function private.k_can_read_profile(uuid) to authenticated;

drop policy if exists k_profiles_read on public.k_profiles;
create policy k_profiles_read on public.k_profiles
for select to authenticated
using (private.k_can_read_profile(id));

-- The application still needs the signed-in person's own row to establish their
-- role. Keep that narrowly scoped instead of exposing self through table SELECT.
create or replace function public.k_current_profile()
returns setof public.k_profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.k_profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

revoke all on function public.k_current_profile() from public, anon;
grant execute on function public.k_current_profile() to authenticated;

drop policy if exists k_profiles_update on public.k_profiles;
create policy k_profiles_update on public.k_profiles
for update to authenticated
using (private.k_is_hr_of(id))
with check (private.k_actor_is_hr());

create or replace function public.k_update_own_telegram(p_telegram_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Необходима авторизация'; end if;
  update public.k_profiles
  set telegram_url=nullif(trim(p_telegram_url),'')
  where id=(select auth.uid()) and is_active;
  if not found then raise exception 'Профиль не найден'; end if;
end
$$;

revoke all on function public.k_update_own_telegram(text) from public, anon;
grant execute on function public.k_update_own_telegram(text) to authenticated;

create or replace function private.k_guard_profile_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    -- Foreign-key actions and trusted server-side administration run without
    -- a JWT. Keep anonymous database roles blocked while allowing Supabase's
    -- service and migration roles to maintain profile references safely.
    if current_user in ('postgres', 'supabase_admin', 'service_role') then
      new.updated_at = now();
      return new;
    end if;
    raise exception 'Необходима авторизация';
  end if;

  -- Everyone except the main administrator may only change Telegram in their
  -- own profile. In particular, an HR cannot promote their own account.
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
    where p.id = new.hr_id and p.is_hr and p.is_active
  ) then
    raise exception 'Назначенный HR должен быть активным HR';
  end if;

  new.updated_at = now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Meetings: overlap detection and atomic create/reschedule
-- ---------------------------------------------------------------------------

create index if not exists k_meetings_active_interval
  on public.k_meetings(scheduled_for, duration_minutes)
  where status <> 'cancelled' and meeting_type <> 'deadline';

create or replace function private.k_meeting_conflict(
  p_participants uuid[],
  p_scheduled_for timestamptz,
  p_duration_minutes integer,
  p_exclude_meeting_id bigint default null
)
returns table(profile_id uuid, full_name text, meeting_id bigint, meeting_title text)
language sql
stable
security definer
set search_path = ''
as $$
  select mp.profile_id, p.full_name, m.id, m.title
  from public.k_meeting_participants mp
  join public.k_meetings m on m.id = mp.meeting_id
  join public.k_profiles p on p.id = mp.profile_id
  where mp.profile_id = any(p_participants)
    and m.status <> 'cancelled'
    and m.meeting_type <> 'deadline'
    and (p_exclude_meeting_id is null or m.id <> p_exclude_meeting_id)
    and tstzrange(
      m.scheduled_for,
      m.scheduled_for + make_interval(mins => m.duration_minutes),
      '[)'
    ) && tstzrange(
      p_scheduled_for,
      p_scheduled_for + make_interval(mins => p_duration_minutes),
      '[)'
    )
  order by m.scheduled_for, p.full_name
  limit 1
$$;

revoke all on function private.k_meeting_conflict(uuid[],timestamptz,integer,bigint) from public;

create or replace function public.k_create_meeting(
  p_title text,
  p_employee_id uuid,
  p_meeting_type text,
  p_scheduled_for timestamptz,
  p_participant_ids uuid[],
  p_participant_roles jsonb default '{}'::jsonb,
  p_duration_minutes integer default 60
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  participant_ids uuid[];
  participant_id uuid;
  conflict_row record;
  v_meeting_id bigint;
begin
  if actor_id is null then raise exception 'Необходима авторизация'; end if;
  if nullif(trim(p_title), '') is null then raise exception 'Укажите название встречи'; end if;
  if p_scheduled_for <= now() then raise exception 'Встречу можно назначить только на будущее время'; end if;
  if p_duration_minutes not between 15 and 480 then raise exception 'Некорректная длительность встречи'; end if;
  if not exists (select 1 from public.k_profiles where id=p_employee_id and is_active) then
    raise exception 'Сотрудник не найден или неактивен';
  end if;
  if p_meeting_type = 'personal' then
    if p_employee_id <> actor_id then raise exception 'Личную встречу можно создать только от своего имени'; end if;
  elsif not (private.k_actor_is_hr() or private.k_is_manager_of(p_employee_id)) then
    raise exception 'Недостаточно прав для назначения встречи';
  end if;

  select array_agg(id order by id) into participant_ids
  from (
    select distinct unnest(array_append(array_append(coalesce(p_participant_ids,'{}'::uuid[]), actor_id), p_employee_id)) as id
  ) people;

  if exists (
    select 1 from unnest(participant_ids) id
    where not exists (select 1 from public.k_profiles p where p.id=id and p.is_active)
  ) then
    raise exception 'Один из участников не найден или неактивен';
  end if;
  if exists (
    select 1 from unnest(participant_ids) id
    where id<>actor_id and not private.k_can_read_profile(id)
  ) then
    raise exception 'Можно пригласить только доступных вам сотрудников';
  end if;

  -- Serialize competing bookings for every participant so two parallel requests
  -- cannot both pass the availability check.
  perform pg_advisory_xact_lock(hashtextextended(id::text, 0))
  from unnest(participant_ids) id
  order by id;

  select * into conflict_row
  from private.k_meeting_conflict(participant_ids, p_scheduled_for, p_duration_minutes, null);
  if found then
    raise exception 'В это время у % уже запланирована встреча «%». Выберите другое время.',
      conflict_row.full_name, conflict_row.meeting_title;
  end if;

  insert into public.k_meetings(
    title, employee_id, organizer_id, meeting_type, scheduled_for, duration_minutes
  ) values (
    trim(p_title), p_employee_id, actor_id, p_meeting_type, p_scheduled_for, p_duration_minutes
  ) returning id into v_meeting_id;

  foreach participant_id in array participant_ids loop
    insert into public.k_meeting_participants(
      meeting_id, profile_id, participation_role, response_status
    ) values (
      v_meeting_id,
      participant_id,
      coalesce(p_participant_roles ->> participant_id::text, 'participant'),
      case when p_meeting_type='personal' and participant_id<>actor_id then 'pending' else 'accepted' end
    );
  end loop;

  insert into public.k_notifications(recipient_id,kind,title,body,dismissible)
  select id, 'meeting_invite', 'Приглашение на встречу',
         trim(p_title) || ' · ' || to_char(p_scheduled_for at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI'), true
  from unnest(participant_ids) id
  where id <> actor_id;

  return v_meeting_id;
end
$$;

revoke all on function public.k_create_meeting(text,uuid,text,timestamptz,uuid[],jsonb,integer) from public, anon;
grant execute on function public.k_create_meeting(text,uuid,text,timestamptz,uuid[],jsonb,integer) to authenticated;

-- Edge Functions use this service-role-only counterpart for onboarding cycles.
create or replace function public.k_create_system_meeting(
  p_title text,
  p_employee_id uuid,
  p_organizer_id uuid,
  p_meeting_type text,
  p_scheduled_for timestamptz,
  p_participants jsonb,
  p_duration_minutes integer default 60
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare participant_ids uuid[]; participant record; conflict_row record; v_meeting_id bigint;
begin
  select array_agg(distinct id order by id) into participant_ids
  from jsonb_to_recordset(p_participants) as x(id uuid,role text);
  if coalesce(array_length(participant_ids,1),0)=0 then raise exception 'У встречи нет участников'; end if;
  perform pg_advisory_xact_lock(hashtextextended(id::text,0)) from unnest(participant_ids) id order by id;
  select * into conflict_row from private.k_meeting_conflict(participant_ids,p_scheduled_for,p_duration_minutes,null);
  if found then
    insert into public.k_notifications(recipient_id,kind,title,body,dismissible)
    values(p_organizer_id,'meeting_conflict','Нужно назначить встречу вручную',
      trim(p_title)||': у '||conflict_row.full_name||' это время уже занято. Выберите другое время.',true);
    return null;
  end if;
  insert into public.k_meetings(title,employee_id,organizer_id,meeting_type,scheduled_for,duration_minutes)
  values(trim(p_title),p_employee_id,p_organizer_id,p_meeting_type,p_scheduled_for,p_duration_minutes)
  returning id into v_meeting_id;
  for participant in select * from jsonb_to_recordset(p_participants) as x(id uuid,role text) loop
    insert into public.k_meeting_participants(meeting_id,profile_id,participation_role)
    values(v_meeting_id,participant.id,participant.role) on conflict do nothing;
  end loop;
  return v_meeting_id;
end
$$;

revoke all on function public.k_create_system_meeting(text,uuid,uuid,text,timestamptz,jsonb,integer) from public, anon, authenticated;
grant execute on function public.k_create_system_meeting(text,uuid,uuid,text,timestamptz,jsonb,integer) to service_role;

create or replace function public.k_request_reschedule(
  p_meeting_id bigint,
  p_proposed_for timestamptz,
  p_reason text default ''
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_meeting public.k_meetings%rowtype;
  participant_ids uuid[];
  conflict_row record;
  request_id bigint;
begin
  if actor_id is null then raise exception 'Необходима авторизация'; end if;
  select * into current_meeting from public.k_meetings where id=p_meeting_id for update;
  if not found or current_meeting.status='cancelled' then raise exception 'Встреча не найдена'; end if;
  if not exists (
    select 1 from public.k_meeting_participants
    where meeting_id=p_meeting_id and profile_id=actor_id
  ) then raise exception 'Перенос может предложить только участник встречи'; end if;
  if p_proposed_for <= now() then raise exception 'Предложите будущее время'; end if;

  select array_agg(profile_id order by profile_id) into participant_ids
  from public.k_meeting_participants where meeting_id=p_meeting_id;
  perform pg_advisory_xact_lock(hashtextextended(id::text,0))
  from unnest(participant_ids) id order by id;
  select * into conflict_row from private.k_meeting_conflict(
    participant_ids, p_proposed_for, current_meeting.duration_minutes, p_meeting_id
  );
  if found then
    raise exception 'В это время у % уже запланирована встреча «%». Выберите другое время.',
      conflict_row.full_name, conflict_row.meeting_title;
  end if;

  insert into public.k_reschedule_requests(meeting_id,requested_by,proposed_for,reason)
  values(p_meeting_id,actor_id,p_proposed_for,coalesce(p_reason,'')) returning id into request_id;
  update public.k_meetings set status='reschedule_requested' where id=p_meeting_id;
  if current_meeting.organizer_id <> actor_id then
    insert into public.k_notifications(recipient_id,kind,title,body,dismissible)
    values(current_meeting.organizer_id,'reschedule_request','Запрос на перенос',
      current_meeting.title || ': предложена новая дата',true);
  end if;
  return request_id;
end
$$;

revoke all on function public.k_request_reschedule(bigint,timestamptz,text) from public, anon;
grant execute on function public.k_request_reschedule(bigint,timestamptz,text) to authenticated;

create or replace function public.k_decide_reschedule(p_request_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  request_row public.k_reschedule_requests%rowtype;
  meeting_row public.k_meetings%rowtype;
  participant_ids uuid[];
  conflict_row record;
begin
  if actor_id is null then raise exception 'Необходима авторизация'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Некорректное решение'; end if;
  select * into request_row from public.k_reschedule_requests where id=p_request_id for update;
  if not found or request_row.status<>'pending' then raise exception 'Запрос уже обработан или не найден'; end if;
  select * into meeting_row from public.k_meetings where id=request_row.meeting_id for update;
  if not (meeting_row.organizer_id=actor_id or private.k_is_hr_of(meeting_row.employee_id)) then
    raise exception 'Недостаточно прав для решения';
  end if;

  if p_status='approved' then
    select array_agg(profile_id order by profile_id) into participant_ids
    from public.k_meeting_participants where meeting_id=meeting_row.id;
    perform pg_advisory_xact_lock(hashtextextended(id::text,0))
    from unnest(participant_ids) id order by id;
    select * into conflict_row from private.k_meeting_conflict(
      participant_ids, request_row.proposed_for, meeting_row.duration_minutes, meeting_row.id
    );
    if found then
      raise exception 'В это время у % уже запланирована встреча «%». Выберите другое время.',
        conflict_row.full_name, conflict_row.meeting_title;
    end if;
    update public.k_meetings set scheduled_for=request_row.proposed_for,status='planned' where id=meeting_row.id;
  else
    update public.k_meetings set status='planned' where id=meeting_row.id;
  end if;

  update public.k_reschedule_requests
  set status=p_status,decided_by=actor_id,decided_at=now()
  where id=request_row.id;
  insert into public.k_notifications(recipient_id,kind,title,body,dismissible)
  values(request_row.requested_by,'reschedule_decision',
    case when p_status='approved' then 'Перенос подтверждён' else 'Перенос отклонён' end,
    case when p_status='approved' then 'Новая дата встречи сохранена у участников' else 'Встреча остаётся в прежнее время' end,
    true);
end
$$;

revoke all on function public.k_decide_reschedule(bigint,text) from public, anon;
grant execute on function public.k_decide_reschedule(bigint,text) to authenticated;

-- Auto-created onboarding slots stay at the prescribed time. When someone is
-- busy, notify the HR and let them choose a time manually instead of silently
-- moving the meeting or creating a collision.
create or replace function private.k_seed_onboarding_meetings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stage record;
  v_meeting_id bigint;
  candidate timestamptz;
  participant_ids uuid[];
begin
  if new.hr_id is null then return new; end if;
  for stage in select * from (values
    ('Первый день', 'first_day', 0, false),
    ('Итоги первой недели', 'first_week', 7, false),
    ('Промежуточная встреча', 'midpoint', 45, true),
    ('Итоги испытательного срока', 'probation_end', 90, true)
  ) v(title, kind, day_offset, with_manager)
  loop
    candidate := ((new.hired_on + stage.day_offset)::timestamp + interval '11 hours') at time zone 'utc';
    continue when candidate < now();
    participant_ids := array_remove(array[
      new.id,new.hr_id,case when stage.with_manager then new.manager_id else null end
    ],null);
    perform pg_advisory_xact_lock(hashtextextended(id::text,0))
    from unnest(participant_ids) id order by id;
    if exists(select 1 from private.k_meeting_conflict(participant_ids,candidate,60,null)) then
      insert into public.k_notifications(recipient_id,kind,title,body,dismissible)
      values(new.hr_id,'meeting_conflict','Нужно назначить встречу вручную',
        stage.title || ' · ' || new.full_name || ': выбранное время уже занято. Выберите другое время.',true);
      continue;
    end if;
    insert into public.k_meetings(title,employee_id,organizer_id,meeting_type,scheduled_for)
    values(stage.title,new.id,new.hr_id,stage.kind,candidate) returning id into v_meeting_id;
    insert into public.k_meeting_participants(meeting_id,profile_id,participation_role)
    values(v_meeting_id,new.id,'employee'),(v_meeting_id,new.hr_id,'hr')
    on conflict (meeting_id,profile_id) do update set participation_role=excluded.participation_role;
    if stage.with_manager and new.manager_id is not null and new.manager_id<>new.hr_id then
      insert into public.k_meeting_participants(meeting_id,profile_id,participation_role)
      values(v_meeting_id,new.manager_id,'manager');
    end if;
    if stage.kind='probation_end' and new.manager_id is not null then
      insert into public.k_meetings(title,employee_id,organizer_id,meeting_type,scheduled_for)
      values('Подготовить ИПР — '||new.full_name,new.id,new.manager_id,'deadline',candidate)
      returning id into v_meeting_id;
      insert into public.k_meeting_participants(meeting_id,profile_id,participation_role)
      values(v_meeting_id,new.manager_id,'manager');
    end if;
  end loop;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Chats: atomic creation, no duplicates, no chats with fewer than two members
-- ---------------------------------------------------------------------------

create or replace function public.k_create_chat(p_title text, p_participant_ids uuid[])
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  member_ids uuid[];
  chat_id bigint;
begin
  if actor_id is null then raise exception 'Необходима авторизация'; end if;
  if nullif(trim(p_title),'') is null then raise exception 'Укажите название чата'; end if;
  select array_agg(id order by id) into member_ids
  from (select distinct unnest(array_append(coalesce(p_participant_ids,'{}'::uuid[]),actor_id)) id) people;
  if coalesce(array_length(member_ids,1),0)<2 then raise exception 'Для чата нужны минимум два участника'; end if;
  if exists (
    select 1 from unnest(member_ids) id
    where not exists(select 1 from public.k_profiles p where p.id=id and p.is_active)
  ) then raise exception 'Один из участников не найден или неактивен'; end if;
  if exists (
    select 1 from unnest(member_ids) id
    where id<>actor_id and not private.k_can_read_profile(id)
  ) then raise exception 'Можно создать чат только с доступными вам сотрудниками'; end if;
  perform pg_advisory_xact_lock(hashtextextended(array_to_string(member_ids,','),1));

  if array_length(member_ids,1)=2 then
    select c.id into chat_id
    from public.k_chats c
    where not c.is_group
      and (select count(*) from public.k_chat_participants cp where cp.chat_id=c.id)=2
      and not exists (
        select 1 from public.k_chat_participants cp
        where cp.chat_id=c.id and not (cp.profile_id=any(member_ids))
      )
    order by c.id
    limit 1;
    if chat_id is not null then return chat_id; end if;
  end if;

  insert into public.k_chats(title,created_by,is_group)
  values(trim(p_title),actor_id,array_length(member_ids,1)>2)
  returning id into chat_id;
  insert into public.k_chat_participants(chat_id,profile_id,last_read_at)
  select chat_id,id,case when id=actor_id then now() else null end from unnest(member_ids) id;
  insert into public.k_notifications(recipient_id,kind,title,body,dismissible)
  select id,'new_chat','Новый чат',trim(p_title),true from unnest(member_ids) id where id<>actor_id;
  return chat_id;
end
$$;

revoke all on function public.k_create_chat(text,uuid[]) from public, anon;
grant execute on function public.k_create_chat(text,uuid[]) to authenticated;
revoke insert on public.k_chats, public.k_chat_participants from authenticated;

create or replace function public.k_create_system_chat(p_title text,p_creator_id uuid,p_participant_ids uuid[])
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare member_ids uuid[]; chat_id bigint;
begin
  select array_agg(id order by id) into member_ids
  from (select distinct unnest(array_append(coalesce(p_participant_ids,'{}'::uuid[]),p_creator_id)) id) people;
  if coalesce(array_length(member_ids,1),0)<2 then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(array_to_string(member_ids,','),1));
  if array_length(member_ids,1)=2 then
    select c.id into chat_id from public.k_chats c
    where not c.is_group
      and (select count(*) from public.k_chat_participants cp where cp.chat_id=c.id)=2
      and not exists(select 1 from public.k_chat_participants cp where cp.chat_id=c.id and not (cp.profile_id=any(member_ids)))
    order by c.id limit 1;
    if chat_id is not null then return chat_id; end if;
  end if;
  insert into public.k_chats(title,created_by,is_group)
  values(trim(p_title),p_creator_id,array_length(member_ids,1)>2) returning id into chat_id;
  insert into public.k_chat_participants(chat_id,profile_id)
  select chat_id,id from unnest(member_ids) id;
  return chat_id;
end
$$;

revoke all on function public.k_create_system_chat(text,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.k_create_system_chat(text,uuid,uuid[]) to service_role;

drop trigger if exists k_remove_empty_chat on public.k_chat_participants;
drop trigger if exists k_enforce_chat_members_after_chat on public.k_chats;
drop trigger if exists k_enforce_chat_members_after_member on public.k_chat_participants;
drop function if exists private.k_remove_empty_chat();

create or replace function private.k_enforce_chat_minimum_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_chat bigint;
begin
  if tg_table_name='k_chats' then
    target_chat := new.id;
  else
    target_chat := old.chat_id;
  end if;
  if exists(select 1 from public.k_chats where id=target_chat)
     and (select count(*) from public.k_chat_participants where chat_id=target_chat)<2 then
    delete from public.k_chats where id=target_chat;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;

create constraint trigger k_enforce_chat_members_after_chat
after insert on public.k_chats
deferrable initially deferred
for each row execute function private.k_enforce_chat_minimum_members();

create constraint trigger k_enforce_chat_members_after_member
after delete on public.k_chat_participants
deferrable initially deferred
for each row execute function private.k_enforce_chat_minimum_members();

-- Merge duplicate personal chats before enforcing the lifecycle rule.
create temporary table _k_duplicate_chats(duplicate_id bigint primary key, keep_id bigint not null) on commit drop;
insert into _k_duplicate_chats(duplicate_id,keep_id)
with grouped as (
  select c.id, string_agg(cp.profile_id::text,',' order by cp.profile_id) signature
  from public.k_chats c
  join public.k_chat_participants cp on cp.chat_id=c.id
  where not c.is_group
  group by c.id
  having count(*)=2
), signatures as (
  select id, row_number() over (partition by signature order by id) row_number,
         min(id) over (partition by signature) keep_id
  from grouped
)
select id,keep_id from signatures where row_number>1;

update public.k_chat_messages m set chat_id=d.keep_id
from _k_duplicate_chats d where m.chat_id=d.duplicate_id;
delete from public.k_chats c using _k_duplicate_chats d where c.id=d.duplicate_id;
delete from public.k_chats c
where (select count(*) from public.k_chat_participants cp where cp.chat_id=c.id)<2;

-- ---------------------------------------------------------------------------
-- Surveys and templates: atomic compound writes
-- ---------------------------------------------------------------------------

create or replace function public.k_send_survey(
  p_template_id bigint,
  p_subject_id uuid,
  p_audience text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := (select auth.uid()); v_run_id bigint; subject_row public.k_profiles%rowtype; template_title text;
begin
  if actor_id is null then raise exception 'Необходима авторизация'; end if;
  if p_audience not in ('person','colleagues','all') then raise exception 'Некорректная аудитория'; end if;
  if not private.k_is_hr_of(p_subject_id) then raise exception 'Можно отправлять опросы только своим сотрудникам'; end if;
  select * into subject_row from public.k_profiles where id=p_subject_id and is_active;
  if not found then raise exception 'Сотрудник не найден'; end if;
  select title into template_title from public.k_survey_templates where id=p_template_id and is_active;
  if template_title is null then raise exception 'Шаблон не найден'; end if;
  insert into public.k_survey_runs(template_id,subject_id,created_by)
  values(p_template_id,p_subject_id,actor_id) returning id into v_run_id;
  insert into public.k_survey_assignments(run_id,respondent_id)
  select v_run_id,id from public.k_profiles p
  where p.is_active and (
    (p_audience='person' and p.id=p_subject_id)
    or (p_audience='all' and p.id<>p_subject_id and (private.k_actor_is_admin() or p.hr_id=actor_id))
    or (p_audience='colleagues' and p.id<>p_subject_id and (p.department=subject_row.department or p.id=subject_row.manager_id))
  ) on conflict do nothing;
  if not exists(select 1 from public.k_survey_assignments where run_id=v_run_id) then
    raise exception 'Для опроса не найдено получателей';
  end if;
  insert into public.k_notifications(recipient_id,kind,title,body,dismissible)
  select respondent_id,'new_survey','Новый опрос',template_title||' · о сотруднике '||subject_row.full_name,true
  from public.k_survey_assignments where run_id=v_run_id;
  return v_run_id;
end
$$;

revoke all on function public.k_send_survey(bigint,uuid,text) from public, anon;
grant execute on function public.k_send_survey(bigint,uuid,text) to authenticated;

create or replace function public.k_submit_survey(p_run_id bigint,p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := (select auth.uid()); answer record;
begin
  if actor_id is null then raise exception 'Необходима авторизация'; end if;
  if not exists(select 1 from public.k_survey_assignments where run_id=p_run_id and respondent_id=actor_id) then
    raise exception 'Опрос не назначен этому пользователю';
  end if;
  for answer in select key::bigint question_id,value #>> '{}' value from jsonb_each(p_answers) loop
    if not exists (
      select 1 from public.k_survey_questions q join public.k_survey_runs r on r.template_id=q.template_id
      where r.id=p_run_id and q.id=answer.question_id
    ) then raise exception 'Некорректный вопрос'; end if;
    insert into public.k_survey_answers(run_id,respondent_id,question_id,value)
    values(p_run_id,actor_id,answer.question_id,answer.value)
    on conflict (run_id,respondent_id,question_id) do update set value=excluded.value,created_at=now();
  end loop;
  update public.k_survey_assignments set completed_at=now() where run_id=p_run_id and respondent_id=actor_id;
end
$$;

revoke all on function public.k_submit_survey(bigint,jsonb) from public, anon;
grant execute on function public.k_submit_survey(bigint,jsonb) to authenticated;

create or replace function public.k_save_survey_template(
  p_template_id bigint,p_title text,p_description text,p_questions jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := (select auth.uid()); question record;
begin
  if actor_id is null or not private.k_actor_is_hr() then raise exception 'Доступно только HR'; end if;
  update public.k_survey_templates set title=trim(p_title),description=coalesce(p_description,''),updated_by=actor_id,updated_at=now()
  where id=p_template_id and is_active;
  if not found then raise exception 'Шаблон не найден'; end if;
  delete from public.k_survey_questions where template_id=p_template_id;
  for question in select * from jsonb_to_recordset(p_questions) as x(text text,answer_type text,position integer) loop
    insert into public.k_survey_questions(template_id,text,answer_type,position)
    values(p_template_id,question.text,question.answer_type,question.position);
  end loop;
end
$$;

revoke all on function public.k_save_survey_template(bigint,text,text,jsonb) from public, anon;
grant execute on function public.k_save_survey_template(bigint,text,text,jsonb) to authenticated;

create or replace function public.k_create_survey_template(
  p_kind text,p_title text,p_description text,p_questions jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := (select auth.uid()); v_template_id bigint; question record;
begin
  if actor_id is null or not private.k_actor_is_hr() then raise exception 'Доступно только HR'; end if;
  insert into public.k_survey_templates(kind,title,description,created_by,updated_by,is_active)
  values(p_kind,trim(p_title),coalesce(p_description,''),actor_id,actor_id,true) returning id into v_template_id;
  for question in select * from jsonb_to_recordset(p_questions) as x(text text,answer_type text,position integer) loop
    insert into public.k_survey_questions(template_id,text,answer_type,position)
    values(v_template_id,question.text,question.answer_type,question.position);
  end loop;
  return v_template_id;
end
$$;

revoke all on function public.k_create_survey_template(text,text,text,jsonb) from public, anon;
grant execute on function public.k_create_survey_template(text,text,text,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Remove review-only test accounts and their history
-- ---------------------------------------------------------------------------

create temporary table _k_test_profiles(id uuid primary key) on commit drop;
insert into _k_test_profiles(id)
select id from public.k_profiles
where lower(trim(full_name)) like 'проверка деплоя%'
   or lower(trim(full_name)) in (
     'тест пробник','тест тестов1234 -','тест тестович','тестнк тестнк'
   );

delete from public.k_chats c where c.created_by in (select id from _k_test_profiles)
  or exists(select 1 from public.k_chat_participants cp where cp.chat_id=c.id and cp.profile_id in (select id from _k_test_profiles));
delete from public.k_chat_messages where author_id in (select id from _k_test_profiles);
delete from public.k_document_recipients where profile_id in (select id from _k_test_profiles);
delete from public.k_document_hidden where profile_id in (select id from _k_test_profiles);
delete from public.k_documents where owner_id in (select id from _k_test_profiles);
delete from public.k_resource_link_recipients where profile_id in (select id from _k_test_profiles);
delete from public.k_resource_link_hidden where profile_id in (select id from _k_test_profiles);
delete from public.k_resource_links where owner_id in (select id from _k_test_profiles);
delete from public.k_survey_schedules where subject_id in (select id from _k_test_profiles) or created_by in (select id from _k_test_profiles);
delete from public.k_survey_runs where subject_id in (select id from _k_test_profiles) or created_by in (select id from _k_test_profiles);
delete from public.k_survey_templates where created_by in (select id from _k_test_profiles);
update public.k_survey_templates set updated_by=null where updated_by in (select id from _k_test_profiles);
delete from public.k_reschedule_requests where requested_by in (select id from _k_test_profiles) or decided_by in (select id from _k_test_profiles);
delete from public.k_meetings where employee_id in (select id from _k_test_profiles) or organizer_id in (select id from _k_test_profiles);
delete from public.k_ipr_tasks where employee_id in (select id from _k_test_profiles) or proposed_by in (select id from _k_test_profiles) or decided_by in (select id from _k_test_profiles);
delete from public.k_notifications where recipient_id in (select id from _k_test_profiles);
delete from auth.users where id in (select id from _k_test_profiles);
