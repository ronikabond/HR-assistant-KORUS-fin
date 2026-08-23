-- До этой миграции все встречи адаптации ставились на фиксированное время (11:00 UTC / 14:00 МСК)
-- независимо от того, сколько ещё встреч уже стоит у того же HR или руководителя в этот день —
-- если несколько сотрудников попадали на один и тот же этап в один день, они накладывались друг на друга.
-- Функция ниже подбирает ближайший свободный получасовой слот для организатора/руководителя в пределах дня.
create or replace function private.k_free_meeting_slot(p_day date, p_participants uuid[])
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  candidate timestamptz;
  step int := 0;
begin
  loop
    candidate := (p_day::timestamp + interval '11 hours' + (step * 30 || ' minutes')::interval) at time zone 'utc';
    exit when not exists (
      select 1 from public.k_meeting_participants mp
      join public.k_meetings m on m.id = mp.meeting_id
      where mp.profile_id = any(p_participants) and m.scheduled_for = candidate
    );
    step := step + 1;
    exit when step > 12; -- запасной выход: после 6 часов подбора просто занимаем последний кандидат
  end loop;
  return candidate;
end $$;

create or replace function private.k_seed_onboarding_meetings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m record; new_meeting_id bigint; slot timestamptz; participants uuid[];
begin
  if new.hr_id is null then return new; end if;
  for m in select * from (values
    ('Первый день', 'first_day', 0),
    ('Итоги первой недели', 'first_week', 7),
    ('Промежуточная встреча', 'midpoint', 45),
    ('Итоги испытательного срока', 'probation_end', 90)
  ) v(title, kind, day_offset)
  loop
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
