-- КОРУС HR assistant prototype. All objects use k_ prefix so the existing
-- "Пульс команды" project remains isolated.

create table if not exists public.k_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login text not null unique,
  full_name text not null,
  job_title text not null default '',
  department text not null default '',
  telegram_url text,
  hired_on date not null default current_date,
  is_hr boolean not null default false,
  is_head_hr boolean not null default false,
  manager_id uuid references public.k_profiles(id) on delete set null,
  hr_id uuid references public.k_profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (manager_id is null or manager_id <> id),
  check (hr_id is null or hr_id <> id),
  check (telegram_url is null or telegram_url = '' or telegram_url ~ '^https?://')
);

create table if not exists public.k_ipr_tasks (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.k_profiles(id) on delete cascade,
  section text not null,
  title text not null,
  description text not null default '',
  expected_result text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  proposed_by uuid not null references public.k_profiles(id),
  decided_by uuid references public.k_profiles(id),
  decided_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.k_meetings (
  id bigint generated always as identity primary key,
  title text not null,
  employee_id uuid not null references public.k_profiles(id) on delete cascade,
  organizer_id uuid not null references public.k_profiles(id),
  meeting_type text not null default 'manual',
  scheduled_for timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  status text not null default 'planned' check (status in ('planned','reschedule_requested','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.k_meeting_participants (
  meeting_id bigint not null references public.k_meetings(id) on delete cascade,
  profile_id uuid not null references public.k_profiles(id) on delete cascade,
  primary key (meeting_id, profile_id)
);

create table if not exists public.k_reschedule_requests (
  id bigint generated always as identity primary key,
  meeting_id bigint not null references public.k_meetings(id) on delete cascade,
  requested_by uuid not null references public.k_profiles(id),
  proposed_for timestamptz not null,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references public.k_profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists k_one_pending_reschedule on public.k_reschedule_requests(meeting_id) where status = 'pending';

create table if not exists public.k_chat_messages (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.k_profiles(id) on delete cascade,
  author_id uuid not null references public.k_profiles(id),
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table if not exists public.k_notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.k_profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  is_read boolean not null default false,
  dismissible boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.k_survey_templates (
  id bigint generated always as identity primary key,
  kind text not null unique check (kind in ('self','colleagues')),
  title text not null,
  description text not null default '',
  updated_by uuid references public.k_profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.k_survey_questions (
  id bigint generated always as identity primary key,
  template_id bigint not null references public.k_survey_templates(id) on delete cascade,
  text text not null,
  answer_type text not null default 'text' check (answer_type in ('text','scale')),
  position integer not null default 0
);

create table if not exists public.k_survey_runs (
  id bigint generated always as identity primary key,
  template_id bigint not null references public.k_survey_templates(id),
  subject_id uuid not null references public.k_profiles(id) on delete cascade,
  created_by uuid not null references public.k_profiles(id),
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.k_survey_assignments (
  run_id bigint not null references public.k_survey_runs(id) on delete cascade,
  respondent_id uuid not null references public.k_profiles(id) on delete cascade,
  completed_at timestamptz,
  primary key (run_id, respondent_id)
);

create table if not exists public.k_survey_answers (
  run_id bigint not null,
  respondent_id uuid not null,
  question_id bigint not null references public.k_survey_questions(id) on delete cascade,
  value text not null,
  created_at timestamptz not null default now(),
  primary key (run_id, respondent_id, question_id),
  foreign key (run_id, respondent_id) references public.k_survey_assignments(run_id, respondent_id) on delete cascade
);

create index if not exists k_profiles_hr on public.k_profiles(hr_id) where is_active;
create index if not exists k_profiles_manager on public.k_profiles(manager_id) where is_active;
create index if not exists k_tasks_employee on public.k_ipr_tasks(employee_id, status);
create index if not exists k_meetings_date on public.k_meetings(scheduled_for);
create index if not exists k_chat_employee on public.k_chat_messages(employee_id, created_at);
create index if not exists k_notifications_recipient on public.k_notifications(recipient_id, is_read);

create schema if not exists private;

create or replace function private.k_actor_is_hr()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.k_profiles where id = (select auth.uid()) and is_hr and is_active)
$$;
create or replace function private.k_actor_is_head_hr()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.k_profiles where id = (select auth.uid()) and is_head_hr and is_active)
$$;
create or replace function private.k_can_access_employee(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select target = (select auth.uid()) or exists(
    select 1 from public.k_profiles p where p.id = target and p.is_active and
    (p.hr_id = (select auth.uid()) or p.manager_id = (select auth.uid()) or private.k_actor_is_head_hr())
  )
$$;
create or replace function private.k_is_manager_of(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.k_profiles p where p.id = target and p.manager_id = (select auth.uid()) and p.is_active)
$$;
create or replace function private.k_is_hr_of(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.k_actor_is_head_hr() or exists(select 1 from public.k_profiles p where p.id = target and p.hr_id = (select auth.uid()) and p.is_active)
$$;

revoke all on function private.k_actor_is_hr() from public;
revoke all on function private.k_actor_is_head_hr() from public;
revoke all on function private.k_can_access_employee(uuid) from public;
revoke all on function private.k_is_manager_of(uuid) from public;
revoke all on function private.k_is_hr_of(uuid) from public;
grant usage on schema private to authenticated;
grant execute on all functions in schema private to authenticated;

create or replace function private.k_guard_profile_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) = old.id and not private.k_actor_is_hr() then
    if (to_jsonb(new) - array['telegram_url','updated_at']) is distinct from (to_jsonb(old) - array['telegram_url','updated_at']) then
      raise exception 'Employees may only change Telegram URL';
    end if;
  end if;
  if new.hr_id is not null and not exists(select 1 from public.k_profiles p where p.id = new.hr_id and p.is_hr and p.is_active) then
    raise exception 'Assigned HR must be active HR';
  end if;
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists k_guard_profile_update on public.k_profiles;
create trigger k_guard_profile_update before update on public.k_profiles for each row execute function private.k_guard_profile_update();

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
    insert into public.k_meeting_participants(meeting_id, profile_id) values(new_meeting_id, new.id), (new_meeting_id, new.hr_id) on conflict do nothing;
    if new.manager_id is not null then insert into public.k_meeting_participants values(new_meeting_id, new.manager_id) on conflict do nothing; end if;
  end loop;
  return new;
end $$;
drop trigger if exists k_seed_onboarding on public.k_profiles;
create trigger k_seed_onboarding after insert on public.k_profiles for each row execute function private.k_seed_onboarding_meetings();

create or replace function private.k_task_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'pending' and new.status in ('approved','rejected') then
    insert into public.k_notifications(recipient_id, kind, title, body, dismissible)
    values(new.employee_id, 'ipr_decision', case when new.status='approved' then 'Задача добавлена в ИПР' else 'Задача отклонена' end,
      new.title, new.status='rejected');
  end if;
  return new;
end $$;
drop trigger if exists k_task_notification on public.k_ipr_tasks;
create trigger k_task_notification after update of status on public.k_ipr_tasks for each row execute function private.k_task_notification();

alter table public.k_profiles enable row level security;
alter table public.k_ipr_tasks enable row level security;
alter table public.k_meetings enable row level security;
alter table public.k_meeting_participants enable row level security;
alter table public.k_reschedule_requests enable row level security;
alter table public.k_chat_messages enable row level security;
alter table public.k_notifications enable row level security;
alter table public.k_survey_templates enable row level security;
alter table public.k_survey_questions enable row level security;
alter table public.k_survey_runs enable row level security;
alter table public.k_survey_assignments enable row level security;
alter table public.k_survey_answers enable row level security;

create policy k_profiles_read on public.k_profiles for select to authenticated using (true);
create policy k_profiles_self_update on public.k_profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy k_profiles_hr_update on public.k_profiles for update to authenticated using (private.k_is_hr_of(id)) with check (private.k_actor_is_hr());

create policy k_tasks_read on public.k_ipr_tasks for select to authenticated using (private.k_can_access_employee(employee_id));
create policy k_tasks_add on public.k_ipr_tasks for insert to authenticated with check (
  (employee_id=(select auth.uid()) and proposed_by=(select auth.uid()) and status='pending') or
  ((private.k_is_manager_of(employee_id) or private.k_is_hr_of(employee_id)) and proposed_by=(select auth.uid()))
);
create policy k_tasks_decide on public.k_ipr_tasks for update to authenticated using (private.k_is_manager_of(employee_id) or private.k_is_hr_of(employee_id)) with check (private.k_can_access_employee(employee_id));
create policy k_tasks_delete on public.k_ipr_tasks for delete to authenticated using (employee_id=(select auth.uid()) and status in ('pending','rejected'));

create policy k_meetings_read on public.k_meetings for select to authenticated using (private.k_can_access_employee(employee_id) or organizer_id=(select auth.uid()));
create policy k_meetings_add on public.k_meetings for insert to authenticated with check ((private.k_actor_is_hr() or private.k_is_manager_of(employee_id)) and organizer_id=(select auth.uid()));
create policy k_meetings_update on public.k_meetings for update to authenticated using (organizer_id=(select auth.uid()) or private.k_is_hr_of(employee_id)) with check (private.k_can_access_employee(employee_id));
create policy k_participants_read on public.k_meeting_participants for select to authenticated using (exists(select 1 from public.k_meetings m where m.id=meeting_id and (private.k_can_access_employee(m.employee_id) or m.organizer_id=(select auth.uid()))));
create policy k_participants_add on public.k_meeting_participants for insert to authenticated with check (exists(select 1 from public.k_meetings m where m.id=meeting_id and m.organizer_id=(select auth.uid())));
create policy k_reschedules_read on public.k_reschedule_requests for select to authenticated using (exists(select 1 from public.k_meetings m where m.id=meeting_id and private.k_can_access_employee(m.employee_id)));
create policy k_reschedules_add on public.k_reschedule_requests for insert to authenticated with check (requested_by=(select auth.uid()) and exists(select 1 from public.k_meeting_participants p where p.meeting_id=k_reschedule_requests.meeting_id and p.profile_id=(select auth.uid())));
create policy k_reschedules_decide on public.k_reschedule_requests for update to authenticated using (exists(select 1 from public.k_meetings m where m.id=meeting_id and private.k_is_hr_of(m.employee_id))) with check (true);

create policy k_chat_read on public.k_chat_messages for select to authenticated using (private.k_can_access_employee(employee_id));
create policy k_chat_send on public.k_chat_messages for insert to authenticated with check (author_id=(select auth.uid()) and private.k_can_access_employee(employee_id));
create policy k_notifications_read on public.k_notifications for select to authenticated using (recipient_id=(select auth.uid()));
create policy k_notifications_update on public.k_notifications for update to authenticated using (recipient_id=(select auth.uid())) with check (recipient_id=(select auth.uid()));
create policy k_notifications_delete on public.k_notifications for delete to authenticated using (recipient_id=(select auth.uid()) and dismissible);

create policy k_templates_read on public.k_survey_templates for select to authenticated using (true);
create policy k_templates_hr on public.k_survey_templates for all to authenticated using (private.k_actor_is_hr()) with check (private.k_actor_is_hr());
create policy k_questions_read on public.k_survey_questions for select to authenticated using (true);
create policy k_questions_hr on public.k_survey_questions for all to authenticated using (private.k_actor_is_hr()) with check (private.k_actor_is_hr());
-- Runs contain no answers, so all signed-in users may read their metadata. Answer
-- visibility is restricted separately; this also avoids recursive RLS lookups.
create policy k_runs_read on public.k_survey_runs for select to authenticated using (true);
create policy k_runs_hr on public.k_survey_runs for insert to authenticated with check (private.k_is_hr_of(subject_id) and created_by=(select auth.uid()));
create policy k_assignments_read on public.k_survey_assignments for select to authenticated using (respondent_id=(select auth.uid()) or exists(select 1 from public.k_survey_runs r where r.id=run_id and private.k_can_access_employee(r.subject_id)));
create policy k_assignments_hr on public.k_survey_assignments for insert to authenticated with check (exists(select 1 from public.k_survey_runs r where r.id=run_id and private.k_is_hr_of(r.subject_id)));
create policy k_assignments_complete on public.k_survey_assignments for update to authenticated using (respondent_id=(select auth.uid())) with check (respondent_id=(select auth.uid()));
create policy k_answers_read on public.k_survey_answers for select to authenticated using (respondent_id=(select auth.uid()) or exists(select 1 from public.k_survey_runs r where r.id=run_id and (private.k_is_hr_of(r.subject_id) or private.k_is_manager_of(r.subject_id))));
create policy k_answers_add on public.k_survey_answers for insert to authenticated with check (respondent_id=(select auth.uid()));

grant select, insert, update, delete on public.k_profiles, public.k_ipr_tasks,
  public.k_meetings, public.k_meeting_participants, public.k_reschedule_requests,
  public.k_chat_messages, public.k_notifications, public.k_survey_templates,
  public.k_survey_questions, public.k_survey_runs, public.k_survey_assignments,
  public.k_survey_answers to authenticated;
grant usage, select on sequence public.k_ipr_tasks_id_seq, public.k_meetings_id_seq,
  public.k_reschedule_requests_id_seq, public.k_chat_messages_id_seq,
  public.k_notifications_id_seq, public.k_survey_templates_id_seq,
  public.k_survey_questions_id_seq, public.k_survey_runs_id_seq to authenticated;

insert into public.k_survey_templates(kind,title,description) values
('self','Опрос сотрудника','Рефлексия сотрудника о результатах, развитии и поддержке'),
('colleagues','Обратная связь от коллег','Профессиональная обратная связь от команды и руководителя')
on conflict (kind) do nothing;

insert into public.k_survey_questions(template_id,text,answer_type,position)
select t.id, q.text, q.answer_type, q.position from public.k_survey_templates t cross join (values
('Как вы оцениваете результаты своей работы за период?', 'scale', 1),
('Какими достижениями вы особенно гордитесь?', 'text', 2),
('Какая задача была самой сложной и почему?', 'text', 3),
('Что из запланированного не удалось реализовать?', 'text', 4),
('Какие навыки вы развили?', 'text', 5),
('В каких областях вам нужна поддержка?', 'text', 6),
('Какой вектор развития вам интересен?', 'text', 7),
('Насколько вы удовлетворены текущими задачами?', 'scale', 8),
('Что вдохновляет вас в работе?', 'text', 9)
) q(text,answer_type,position) where t.kind='self' and not exists(select 1 from public.k_survey_questions where template_id=t.id);

insert into public.k_survey_questions(template_id,text,answer_type,position)
select t.id, q.text, q.answer_type, q.position from public.k_survey_templates t cross join (values
('Какие профессиональные сильные стороны сотрудника вы отмечаете?', 'text', 1),
('Какие зоны роста вы видите?', 'text', 2),
('Насколько комфортно вам работать вместе?', 'scale', 3),
('Как вы оцениваете стиль коммуникации?', 'text', 4),
('Как сотрудник реагирует на сложные ситуации?', 'text', 5),
('Как вы оцениваете уровень экспертизы?', 'scale', 6),
('Соблюдает ли сотрудник договорённости и сроки?', 'scale', 7),
('Насколько он отзывчив и инициативен?', 'scale', 8),
('Насколько предлагаемые решения соответствуют задаче?', 'scale', 9),
('Дополнительный комментарий', 'text', 10)
) q(text,answer_type,position) where t.kind='colleagues' and not exists(select 1 from public.k_survey_questions where template_id=t.id);
