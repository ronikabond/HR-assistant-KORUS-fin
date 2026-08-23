-- Если сотрудника заводят (вручную или импортом из файла) с датой выхода в прошлом,
-- часть этапов адаптации уже давно должна была пройти — например, «Первый день» и
-- «Итоги первой недели» для сотрудника, который уже месяц как работает. До этой миграции
-- триггер всё равно ставил такие встречи задним числом. Теперь каждый этап пропускается
-- по отдельности, если его расчётная дата уже в прошлом — остальные этапы ставятся как обычно.
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
  end loop;
  return new;
end $$;
