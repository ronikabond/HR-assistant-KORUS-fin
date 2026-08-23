-- К встрече «Итоги испытательного срока» руководитель должен представить сотруднику ИПР.
-- Кроме напоминания в уведомлениях, ставим руководителю отдельную запись-дедлайн прямо
-- в календарь, тем же цветом, что и легенда «Дедлайн» (она была заведена заранее, но
-- пока ничем не заполнялась) — на то же время, что и сама встреча «Итоги испытательного срока».
create or replace function private.k_seed_onboarding_meetings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m record; new_meeting_id bigint; slot timestamptz; participants uuid[]; raw_date timestamptz;
begin
  if new.hr_id is null then return new; end if;
  for m in select * from (values
    ('Первый день', 'first_day', 0),
    ('Итоги первой недели', 'first_week', 7),
    ('Промежуточная встреча', 'midpoint', 45),
    ('Итоги испытательного срока', 'probation_end', 90)
  ) v(title, kind, day_offset)
  loop
    raw_date := (new.hired_on + m.day_offset)::timestamp + interval '11 hours';
    continue when raw_date < now();
    participants := array[new.hr_id];
    if new.manager_id is not null then participants := participants || new.manager_id; end if;
    slot := private.k_free_meeting_slot((new.hired_on + m.day_offset)::date, participants);
    insert into public.k_meetings(title, employee_id, organizer_id, meeting_type, scheduled_for)
    values(m.title, new.id, new.hr_id, m.kind, slot)
    returning id into new_meeting_id;
    insert into public.k_meeting_participants(meeting_id, profile_id, participation_role)
    values(new_meeting_id, new.id, 'employee'), (new_meeting_id, new.hr_id, 'hr')
    on conflict (meeting_id, profile_id) do update set participation_role = excluded.participation_role;
    if new.manager_id is not null and new.manager_id <> new.hr_id then
      insert into public.k_meeting_participants(meeting_id, profile_id, participation_role)
      values(new_meeting_id, new.manager_id, 'manager')
      on conflict (meeting_id, profile_id) do update set participation_role = excluded.participation_role;
    end if;
    if m.kind = 'probation_end' and new.manager_id is not null then
      insert into public.k_meetings(title, employee_id, organizer_id, meeting_type, scheduled_for)
      values('Подготовить ИПР — ' || new.full_name, new.id, new.manager_id, 'deadline', slot)
      returning id into new_meeting_id;
      insert into public.k_meeting_participants(meeting_id, profile_id, participation_role)
      values(new_meeting_id, new.manager_id, 'manager');
    end if;
  end loop;
  return new;
end $$;
