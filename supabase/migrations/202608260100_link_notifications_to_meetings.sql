alter table public.k_notifications
  add column if not exists meeting_id bigint references public.k_meetings(id) on delete set null;

create index if not exists k_notifications_meeting_id_idx
  on public.k_notifications(meeting_id)
  where meeting_id is not null;

-- Preserve links for invitations created before this column existed.
update public.k_notifications notification
set meeting_id=meeting.id
from public.k_meetings meeting
where notification.meeting_id is null
  and notification.kind='meeting_invite'
  and notification.body=trim(meeting.title)||' · '||to_char(meeting.scheduled_for at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI')
  and exists (
    select 1
    from public.k_meeting_participants participant
    where participant.meeting_id=meeting.id
      and participant.profile_id=notification.recipient_id
  );

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
  if nullif(trim(p_title),'') is null then raise exception 'Укажите название встречи'; end if;
  if p_scheduled_for <= now() then raise exception 'Встречу можно назначить только на будущее время'; end if;
  if p_duration_minutes not between 15 and 480 then raise exception 'Некорректная длительность встречи'; end if;
  if not exists(select 1 from public.k_profiles where id=p_employee_id and is_active) then
    raise exception 'Сотрудник не найден или неактивен';
  end if;

  if p_meeting_type='personal' then
    if p_employee_id<>actor_id then raise exception 'Личную встречу можно создать только от своего имени'; end if;
  elsif not (private.k_actor_is_hr() or private.k_is_manager_of(p_employee_id)) then
    raise exception 'Недостаточно прав для назначения встречи';
  end if;

  select array_agg(id order by id) into participant_ids
  from (
    select distinct unnest(array_append(array_append(coalesce(p_participant_ids,'{}'::uuid[]),actor_id),p_employee_id)) as id
  ) people;

  if exists (
    select 1 from unnest(participant_ids) id
    where not exists(select 1 from public.k_profiles profile where profile.id=id and profile.is_active)
  ) then
    raise exception 'Один из участников не найден или неактивен';
  end if;
  if exists (
    select 1 from unnest(participant_ids) id
    where id<>actor_id and not private.k_can_read_profile(id)
  ) then
    raise exception 'Можно пригласить только доступных вам сотрудников';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(id::text,0))
  from unnest(participant_ids) id
  order by id;

  select * into conflict_row
  from private.k_meeting_conflict(participant_ids,p_scheduled_for,p_duration_minutes,null);
  if found then
    raise exception 'В это время у % уже запланирована встреча «%». Выберите другое время.',
      conflict_row.full_name,conflict_row.meeting_title;
  end if;

  insert into public.k_meetings(
    title,employee_id,organizer_id,meeting_type,scheduled_for,duration_minutes
  ) values (
    trim(p_title),p_employee_id,actor_id,p_meeting_type,p_scheduled_for,p_duration_minutes
  ) returning id into v_meeting_id;

  foreach participant_id in array participant_ids loop
    insert into public.k_meeting_participants(
      meeting_id,profile_id,participation_role,response_status
    ) values (
      v_meeting_id,
      participant_id,
      coalesce(p_participant_roles->>participant_id::text,'participant'),
      case when p_meeting_type='personal' and participant_id<>actor_id then 'pending' else 'accepted' end
    );
  end loop;

  insert into public.k_notifications(recipient_id,meeting_id,kind,title,body,dismissible)
  select id,v_meeting_id,'meeting_invite','Приглашение на встречу',
    trim(p_title)||' · '||to_char(p_scheduled_for at time zone 'Europe/Moscow','DD.MM.YYYY HH24:MI'),true
  from unnest(participant_ids) id
  where id<>actor_id;

  return v_meeting_id;
end
$$;

revoke all on function public.k_create_meeting(text,uuid,text,timestamptz,uuid[],jsonb,integer) from public, anon;
grant execute on function public.k_create_meeting(text,uuid,text,timestamptz,uuid[],jsonb,integer) to authenticated;
