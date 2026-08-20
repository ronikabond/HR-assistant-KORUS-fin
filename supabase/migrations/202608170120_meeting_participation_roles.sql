-- A person can participate in different meetings as an employee, HR or manager.
-- Store that role on the meeting-participant relationship so calendar colors
-- describe the concrete meeting rather than a person's permanent attributes.

alter table public.k_meeting_participants
  add column if not exists participation_role text not null default 'participant'
  check (participation_role in ('employee', 'hr', 'manager', 'participant'));

update public.k_meeting_participants mp
set participation_role = case
  when mp.profile_id = m.employee_id then 'employee'
  when mp.profile_id = employee.hr_id then 'hr'
  when mp.profile_id = employee.manager_id then 'manager'
  when mp.profile_id = m.organizer_id and organizer.is_hr then 'hr'
  else 'participant'
end
from public.k_meetings m
join public.k_profiles employee on employee.id = m.employee_id
join public.k_profiles organizer on organizer.id = m.organizer_id
where m.id = mp.meeting_id;

create or replace function private.k_seed_onboarding_meetings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m record; new_meeting_id bigint;
begin
  if new.hr_id is null then return new; end if;
  for m in select * from (values
    ('Первый день', 'first_day', 0),
    ('Итоги первой недели', 'first_week', 7),
    ('Промежуточная встреча', 'midpoint', 45),
    ('Итоги испытательного срока', 'probation_end', 90)
  ) v(title, kind, day_offset)
  loop
    insert into public.k_meetings(title, employee_id, organizer_id, meeting_type, scheduled_for)
    values(m.title, new.id, new.hr_id, m.kind, (new.hired_on + m.day_offset)::timestamp + interval '11 hours')
    returning id into new_meeting_id;
    insert into public.k_meeting_participants(meeting_id, profile_id, participation_role)
    values(new_meeting_id, new.id, 'employee'), (new_meeting_id, new.hr_id, 'hr')
    on conflict (meeting_id, profile_id) do update set participation_role = excluded.participation_role;
    if new.manager_id is not null and new.manager_id <> new.hr_id then
      insert into public.k_meeting_participants(meeting_id, profile_id, participation_role)
      values(new_meeting_id, new.manager_id, 'manager')
      on conflict (meeting_id, profile_id) do update set participation_role = excluded.participation_role;
    end if;
  end loop;
  return new;
end $$;

-- Demonstration: the main HR has two simultaneous meetings in different roles.
with people as (
  select
    (array_agg(id) filter (where login = 'НРглавный'))[1] as head_id,
    (array_agg(id) filter (where login = 'НР1_2026'))[1] as hr1_id,
    (array_agg(id) filter (where login = 'НР2_2026'))[1] as hr2_id
  from public.k_profiles
), inserted as (
  insert into public.k_meetings(title, employee_id, organizer_id, meeting_type, scheduled_for)
  select 'Сверка адаптации HR-команды', hr1_id, head_id, 'development', '2026-08-21 11:00:00+03'::timestamptz from people
  where not exists (select 1 from public.k_meetings where title = 'Сверка адаптации HR-команды')
  returning id, title
)
insert into public.k_meeting_participants(meeting_id, profile_id, participation_role)
select i.id, p.hr1_id, 'employee' from inserted i cross join people p
union all
select i.id, p.head_id, 'hr' from inserted i cross join people p
on conflict (meeting_id, profile_id) do update set participation_role = excluded.participation_role;

with people as (
  select
    (array_agg(id) filter (where login = 'НРглавный'))[1] as head_id,
    (array_agg(id) filter (where login = 'НР1_2026'))[1] as hr1_id,
    (array_agg(id) filter (where login = 'НР2_2026'))[1] as hr2_id
  from public.k_profiles
), inserted as (
  insert into public.k_meetings(title, employee_id, organizer_id, meeting_type, scheduled_for)
  select 'Ревью HR-процессов', hr2_id, hr1_id, 'development', '2026-08-21 11:00:00+03'::timestamptz from people
  where not exists (select 1 from public.k_meetings where title = 'Ревью HR-процессов')
  returning id, title
)
insert into public.k_meeting_participants(meeting_id, profile_id, participation_role)
select i.id, p.hr2_id, 'employee' from inserted i cross join people p
union all
select i.id, p.hr1_id, 'hr' from inserted i cross join people p
union all
select i.id, p.head_id, 'manager' from inserted i cross join people p
on conflict (meeting_id, profile_id) do update set participation_role = excluded.participation_role;

-- Demonstration: a regular HR has simultaneous meetings as employee and as HR.
with people as (
  select
    (array_agg(id) filter (where login = 'НРглавный'))[1] as head_id,
    (array_agg(id) filter (where login = 'НР1_2026'))[1] as hr1_id,
    (array_agg(id) filter (where login = 'сотрудник2'))[1] as employee_id
  from public.k_profiles
), inserted as (
  insert into public.k_meetings(title, employee_id, organizer_id, meeting_type, scheduled_for)
  select 'Личная встреча с HR', hr1_id, head_id, 'development', '2026-08-24 15:00:00+03'::timestamptz from people
  where not exists (select 1 from public.k_meetings where title = 'Личная встреча с HR')
  returning id
)
insert into public.k_meeting_participants(meeting_id, profile_id, participation_role)
select i.id, p.hr1_id, 'employee' from inserted i cross join people p
union all
select i.id, p.head_id, 'hr' from inserted i cross join people p
on conflict (meeting_id, profile_id) do update set participation_role = excluded.participation_role;

with people as (
  select
    (array_agg(id) filter (where login = 'НР1_2026'))[1] as hr1_id,
    (array_agg(id) filter (where login = 'руководитель2'))[1] as manager_id,
    (array_agg(id) filter (where login = 'сотрудник2'))[1] as employee_id
  from public.k_profiles
), inserted as (
  insert into public.k_meetings(title, employee_id, organizer_id, meeting_type, scheduled_for)
  select 'Проверка плана адаптации', employee_id, hr1_id, 'development', '2026-08-24 15:00:00+03'::timestamptz from people
  where not exists (select 1 from public.k_meetings where title = 'Проверка плана адаптации')
  returning id
)
insert into public.k_meeting_participants(meeting_id, profile_id, participation_role)
select i.id, p.employee_id, 'employee' from inserted i cross join people p
union all
select i.id, p.hr1_id, 'hr' from inserted i cross join people p
union all
select i.id, p.manager_id, 'manager' from inserted i cross join people p
on conflict (meeting_id, profile_id) do update set participation_role = excluded.participation_role;
