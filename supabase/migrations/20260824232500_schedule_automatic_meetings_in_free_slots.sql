-- Automatic meetings prefer the standard time, then move to the next free
-- half-hour slot on the same day. Manual scheduling is requested only when the
-- participants have no free slot in the available window.

create or replace function private.k_find_available_meeting_slot(
  p_participants uuid[],
  p_preferred timestamptz,
  p_duration_minutes integer default 60
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select slots.candidate
  from (
    select generate_series(
      p_preferred,
      p_preferred + interval '6 hours',
      interval '30 minutes'
    ) as candidate
    union all
    select generate_series(
      p_preferred - interval '2 hours',
      p_preferred - interval '30 minutes',
      interval '30 minutes'
    ) as candidate
  ) slots
  where slots.candidate > now()
    and (slots.candidate at time zone 'utc')::date = (p_preferred at time zone 'utc')::date
    and not exists (
      select 1
      from private.k_meeting_conflict(
        p_participants,slots.candidate,p_duration_minutes,null
      )
    )
  order by
    case when slots.candidate >= p_preferred then 0 else 1 end,
    slots.candidate
  limit 1
$$;

revoke all on function private.k_find_available_meeting_slot(uuid[],timestamptz,integer) from public;

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
declare
  participant_ids uuid[];
  participant record;
  selected_slot timestamptz;
  v_meeting_id bigint;
begin
  select array_agg(distinct id order by id) into participant_ids
  from jsonb_to_recordset(p_participants) as x(id uuid,role text);
  if coalesce(array_length(participant_ids,1),0)=0 then
    raise exception 'У встречи нет участников';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(id::text,0))
  from unnest(participant_ids) id order by id;

  if p_meeting_type='deadline' then
    selected_slot := p_scheduled_for;
  else
    selected_slot := private.k_find_available_meeting_slot(
      participant_ids,p_scheduled_for,p_duration_minutes
    );
  end if;

  if selected_slot is null then
    insert into public.k_notifications(recipient_id,kind,title,body,dismissible)
    values(
      p_organizer_id,'meeting_conflict','Нужно назначить встречу вручную',
      trim(p_title)||': в этот день у участников нет свободного времени. Выберите другую дату.',true
    );
    return null;
  end if;

  insert into public.k_meetings(
    title,employee_id,organizer_id,meeting_type,scheduled_for,duration_minutes
  ) values (
    trim(p_title),p_employee_id,p_organizer_id,p_meeting_type,selected_slot,p_duration_minutes
  ) returning id into v_meeting_id;

  for participant in
    select * from jsonb_to_recordset(p_participants) as x(id uuid,role text)
  loop
    insert into public.k_meeting_participants(
      meeting_id,profile_id,participation_role
    ) values (
      v_meeting_id,participant.id,participant.role
    ) on conflict do nothing;
  end loop;
  return v_meeting_id;
end
$$;

revoke all on function public.k_create_system_meeting(text,uuid,uuid,text,timestamptz,jsonb,integer) from public, anon, authenticated;
grant execute on function public.k_create_system_meeting(text,uuid,uuid,text,timestamptz,jsonb,integer) to service_role;

create or replace function private.k_seed_onboarding_meetings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stage record;
  v_meeting_id bigint;
  preferred timestamptz;
  selected_slot timestamptz;
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
    preferred := ((new.hired_on + stage.day_offset)::timestamp + interval '11 hours') at time zone 'utc';
    continue when preferred < now();
    participant_ids := array_remove(array[
      new.id,new.hr_id,case when stage.with_manager then new.manager_id else null end
    ],null);
    perform pg_advisory_xact_lock(hashtextextended(id::text,0))
    from unnest(participant_ids) id order by id;
    selected_slot := private.k_find_available_meeting_slot(participant_ids,preferred,60);
    if selected_slot is null then
      insert into public.k_notifications(recipient_id,kind,title,body,dismissible)
      values(
        new.hr_id,'meeting_conflict','Нужно назначить встречу вручную',
        stage.title||' · '||new.full_name||': в этот день нет свободного времени. Выберите другую дату.',true
      );
      continue;
    end if;

    insert into public.k_meetings(
      title,employee_id,organizer_id,meeting_type,scheduled_for
    ) values (
      stage.title,new.id,new.hr_id,stage.kind,selected_slot
    ) returning id into v_meeting_id;
    insert into public.k_meeting_participants(
      meeting_id,profile_id,participation_role
    ) values
      (v_meeting_id,new.id,'employee'),
      (v_meeting_id,new.hr_id,'hr')
    on conflict (meeting_id,profile_id)
    do update set participation_role=excluded.participation_role;
    if stage.with_manager and new.manager_id is not null and new.manager_id<>new.hr_id then
      insert into public.k_meeting_participants(
        meeting_id,profile_id,participation_role
      ) values (
        v_meeting_id,new.manager_id,'manager'
      );
    end if;
    if stage.kind='probation_end' and new.manager_id is not null then
      insert into public.k_meetings(
        title,employee_id,organizer_id,meeting_type,scheduled_for
      ) values (
        'Подготовить ИПР — '||new.full_name,new.id,new.manager_id,'deadline',selected_slot
      ) returning id into v_meeting_id;
      insert into public.k_meeting_participants(
        meeting_id,profile_id,participation_role
      ) values (
        v_meeting_id,new.manager_id,'manager'
      );
    end if;
  end loop;
  return new;
end
$$;

-- Remove obsolete warnings from the old fixed-slot behavior before backfill.
delete from public.k_notifications where kind='meeting_conflict';

-- Backfill only the accounts created interactively after the clean demo reset.
do $$
declare
  employee record;
  stage record;
  half integer;
  preferred timestamptz;
  participants jsonb;
  created_meeting_id bigint;
  selected_slot timestamptz;
  desired_count integer;
  kind text;
  title text;
begin
  for employee in
    select p.*
    from public.k_profiles p
    where p.is_active
      and p.hr_id is not null
      and p.created_at >= '2026-08-24 20:00:00+00'::timestamptz
    order by p.created_at,p.id
  loop
    for stage in select * from (values
      ('Первый день', 'first_day', 0, false),
      ('Итоги первой недели', 'first_week', 7, false),
      ('Промежуточная встреча', 'midpoint', 45, true),
      ('Итоги испытательного срока', 'probation_end', 90, true)
    ) v(title, kind, day_offset, with_manager)
    loop
      preferred := ((employee.hired_on + stage.day_offset)::timestamp + interval '11 hours') at time zone 'utc';
      continue when preferred < now();
      continue when exists (
        select 1 from public.k_meetings m
        where m.employee_id=employee.id and m.meeting_type=stage.kind
      );
      participants := jsonb_build_array(
        jsonb_build_object('id',employee.id,'role','employee'),
        jsonb_build_object('id',employee.hr_id,'role','hr')
      );
      if stage.with_manager and employee.manager_id is not null and employee.manager_id<>employee.hr_id then
        participants := participants || jsonb_build_array(
          jsonb_build_object('id',employee.manager_id,'role','manager')
        );
      end if;
      created_meeting_id := public.k_create_system_meeting(
        stage.title,employee.id,employee.hr_id,stage.kind,preferred,participants,60
      );
      if stage.kind='probation_end'
         and created_meeting_id is not null
         and employee.manager_id is not null
         and not exists (
           select 1 from public.k_meetings m
           where m.employee_id=employee.id and m.meeting_type='deadline'
         ) then
        select m.scheduled_for into selected_slot
        from public.k_meetings m where m.id=created_meeting_id;
        perform public.k_create_system_meeting(
          'Подготовить ИПР — '||employee.full_name,
          employee.id,employee.manager_id,'deadline',selected_slot,
          jsonb_build_array(jsonb_build_object('id',employee.manager_id,'role','manager')),60
        );
      end if;
    end loop;

    for half in 1..4 loop
      kind := case when half%2=0 then 'annual_review' else 'ipr_checkin' end;
      title := case when half%2=0
        then 'Итоговая годовая встреча по ИПР'
        else 'Промежуточная встреча по ИПР'
      end;
      desired_count := (half+1)/2;
      continue when (
        select count(*) from public.k_meetings m
        where m.employee_id=employee.id and m.meeting_type=kind
      ) >= desired_count;
      preferred := (
        (employee.hired_on + 90)::timestamp + interval '11 hours'
        + make_interval(months=>half*6)
      ) at time zone 'utc';
      continue when preferred < now();
      participants := jsonb_build_array(
        jsonb_build_object('id',employee.id,'role','employee'),
        jsonb_build_object('id',employee.hr_id,'role','hr')
      );
      if employee.manager_id is not null and employee.manager_id<>employee.hr_id then
        participants := participants || jsonb_build_array(
          jsonb_build_object('id',employee.manager_id,'role','manager')
        );
      end if;
      perform public.k_create_system_meeting(
        title,employee.id,employee.hr_id,kind,preferred,participants,60
      );
    end loop;
  end loop;
end
$$;
