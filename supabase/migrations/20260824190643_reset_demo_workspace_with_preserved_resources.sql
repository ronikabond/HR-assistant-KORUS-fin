-- Rebuild the demonstration workspace while preserving uploaded documents and links.
-- The Edge Function creates Auth users first and then calls this function once.
create or replace function public.k_replace_demo_workspace(
  p_accounts jsonb,
  p_document_paths jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  head_id uuid := nullif(p_accounts #>> '{head,id}','')::uuid;
  hr_id uuid := nullif(p_accounts #>> '{hr,id}','')::uuid;
  manager_id uuid := nullif(p_accounts #>> '{manager,id}','')::uuid;
  ilya_id uuid := nullif(p_accounts #>> '{ilya,id}','')::uuid;
  darya_id uuid := nullif(p_accounts #>> '{darya,id}','')::uuid;
  new_ids uuid[];
  account_count integer;
  meeting_id bigint;
  chat_id bigint;
  survey_run_id bigint;
  self_template_id bigint;
  colleagues_template_id bigint;
begin
  if head_id is null or hr_id is null or manager_id is null or ilya_id is null or darya_id is null then
    raise exception 'Для сброса нужны пять новых аккаунтов';
  end if;
  new_ids := array[head_id,hr_id,manager_id,ilya_id,darya_id];
  if (select count(distinct id) from unnest(new_ids) id)<>5 then
    raise exception 'Идентификаторы новых аккаунтов должны отличаться';
  end if;
  select count(*) into account_count from auth.users where id=any(new_ids);
  if account_count<>5 then raise exception 'Новые Auth-аккаунты ещё не созданы'; end if;

  -- Insert profiles without relationships so onboarding triggers cannot create
  -- extra meetings. The curated demo meetings are inserted below.
  insert into public.k_profiles(
    id,login,full_name,job_title,department,direction,corporate_email,phone,
    hired_on,is_hr,is_head_hr,is_active
  )
  select
    (account.value->>'id')::uuid,
    account.value->>'login',
    account.value->>'full_name',
    coalesce(account.value->>'job_title',''),
    coalesce(account.value->>'department',''),
    coalesce(account.value->>'direction',''),
    coalesce(account.value->>'corporate_email',''),
    coalesce(account.value->>'phone',''),
    coalesce(nullif(account.value->>'hired_on','')::date,current_date),
    coalesce((account.value->>'is_hr')::boolean,false),
    coalesce((account.value->>'is_head_hr')::boolean,false),
    true
  from jsonb_each(p_accounts) account
  where account.key in ('head','hr','manager','ilya','darya');

  -- Preserve resources, clear obsolete personal sharing, and make them visible
  -- to the fresh demo office. Storage paths point to copies prepared by the
  -- Edge Function, so old Auth users no longer own the retained file objects.
  update public.k_documents d
  set storage_path=paths.new_path,updated_at=now()
  from jsonb_to_recordset(coalesce(p_document_paths,'[]'::jsonb)) as paths(id bigint,new_path text)
  where d.id=paths.id;
  delete from public.k_document_recipients where true;
  delete from public.k_document_hidden where true;
  delete from public.k_resource_link_recipients where true;
  delete from public.k_resource_link_hidden where true;
  update public.k_documents set owner_id=head_id,access_scope='office',department=null,updated_at=now() where true;
  update public.k_resource_links set owner_id=head_id,access_scope='office',department=null,updated_at=now() where true;

  -- Remove all user-generated history and operational data.
  delete from public.k_survey_answers where true;
  delete from public.k_survey_assignments where true;
  delete from public.k_survey_runs where true;
  delete from public.k_survey_schedules where true;
  delete from public.k_notifications where true;
  delete from public.k_reschedule_requests where true;
  delete from public.k_meetings where true;
  delete from public.k_ipr_tasks where true;
  delete from public.k_chat_messages where true;
  delete from public.k_chats where true;

  -- Keep the two standard survey templates, but remove old custom drafts.
  delete from public.k_survey_templates where kind='custom';
  update public.k_survey_templates
  set created_by=head_id,updated_by=head_id,updated_at=now(),is_active=true
  where kind in ('self','colleagues');

  -- Removing old profiles cascades their demo-account rows. Documents and
  -- links survive because ownership was reassigned above.
  delete from public.k_profiles where not (id=any(new_ids));

  update public.k_profiles set hr_id=head_id,manager_id=head_id where id=hr_id;
  update public.k_profiles set hr_id=hr_id,manager_id=null where id=manager_id;
  update public.k_profiles set hr_id=hr_id,manager_id=manager_id where id=ilya_id;
  update public.k_profiles set hr_id=head_id,manager_id=manager_id where id=darya_id;

  insert into public.k_demo_accounts(profile_id,login,demo_password,full_name,job_title,role_label,is_active)
  select
    (account.value->>'id')::uuid,
    account.value->>'login',
    account.value->>'password',
    account.value->>'full_name',
    coalesce(account.value->>'job_title',''),
    account.value->>'role_label',
    true
  from jsonb_each(p_accounts) account
  where account.key in ('head','hr','manager','ilya','darya');

  -- A compact but varied IPR dataset for HR and manager demonstrations.
  insert into public.k_ipr_tasks(
    employee_id,section,title,description,expected_result,status,proposed_by,
    decided_by,decided_at,is_completed,completed_at,created_at
  ) values
  (hr_id,'Проектная деятельность','Настроить цикл адаптации новой команды',
    'Согласовать роли, контрольные встречи и формат обратной связи.',
    'У команды есть единый план сопровождения на ближайший месяц.',
    'approved',hr_id,head_id,now()-interval '4 days',true,now()-interval '1 day',now()-interval '5 days'),
  (manager_id,'Развитие навыков и компетенций','Сформировать план развития команды',
    'Провести короткие встречи с Ильёй и Дарьей и зафиксировать зоны роста.',
    'Для каждого сотрудника определены две измеримые цели.',
    'approved',manager_id,hr_id,now()-interval '2 days',false,null,now()-interval '3 days'),
  (ilya_id,'Проектная деятельность','Подготовить карту процесса адаптации',
    'Описать текущие шаги, участников и точки контроля.',
    'Карта согласована с Еленой и Олегом.',
    'approved',manager_id,manager_id,now()-interval '1 day',false,null,now()-interval '2 days'),
  (ilya_id,'Развитие навыков и компетенций','Освоить проведение статус-встреч',
    'Подготовить повестку и самостоятельно провести одну встречу команды.',
    'Получена обратная связь от руководителя.',
    'pending',ilya_id,null,null,false,null,now()-interval '6 hours'),
  (darya_id,'Проектная деятельность','Подготовить аналитическую записку',
    'Собрать вводные и оформить рекомендации по процессу онбординга.',
    'Записка принята руководителем без критичных замечаний.',
    'approved',darya_id,manager_id,now()-interval '12 hours',false,null,now()-interval '2 days');

  -- Future meetings are relative to reset day so the demo remains useful.
  insert into public.k_meetings(title,employee_id,organizer_id,meeting_type,scheduled_for,duration_minutes)
  values('Сверка адаптации Елены',manager_id,hr_id,'personal',
    ((current_date+3)+time '11:00') at time zone 'Europe/Moscow',60)
  returning id into meeting_id;
  insert into public.k_meeting_participants(meeting_id,profile_id,participation_role,response_status)
  values(meeting_id,manager_id,'employee','accepted'),(meeting_id,hr_id,'hr','accepted');

  insert into public.k_meetings(title,employee_id,organizer_id,meeting_type,scheduled_for,duration_minutes)
  values('План развития Ильи',ilya_id,hr_id,'personal',
    ((current_date+7)+time '10:00') at time zone 'Europe/Moscow',60)
  returning id into meeting_id;
  insert into public.k_meeting_participants(meeting_id,profile_id,participation_role,response_status)
  values(meeting_id,ilya_id,'employee','accepted'),(meeting_id,hr_id,'hr','accepted'),
    (meeting_id,manager_id,'manager','accepted');

  insert into public.k_meetings(title,employee_id,organizer_id,meeting_type,scheduled_for,duration_minutes)
  values('Обсуждение ИПР Дарьи',darya_id,head_id,'personal',
    ((current_date+10)+time '14:00') at time zone 'Europe/Moscow',60)
  returning id into meeting_id;
  insert into public.k_meeting_participants(meeting_id,profile_id,participation_role,response_status)
  values(meeting_id,darya_id,'employee','pending'),(meeting_id,head_id,'hr','accepted'),
    (meeting_id,manager_id,'manager','accepted');

  insert into public.k_meetings(title,employee_id,organizer_id,meeting_type,scheduled_for,duration_minutes)
  values('Командная встреча по адаптации',ilya_id,manager_id,'personal',
    ((current_date+14)+time '16:00') at time zone 'Europe/Moscow',60)
  returning id into meeting_id;
  insert into public.k_meeting_participants(meeting_id,profile_id,participation_role,response_status)
  values(meeting_id,manager_id,'manager','accepted'),(meeting_id,hr_id,'hr','accepted'),
    (meeting_id,ilya_id,'employee','accepted'),(meeting_id,darya_id,'participant','pending');

  insert into public.k_meetings(title,employee_id,organizer_id,meeting_type,scheduled_for,duration_minutes)
  values('Итоги первого месяца Олега',hr_id,head_id,'first_month',
    ((current_date+30)+time '11:00') at time zone 'Europe/Moscow',60)
  returning id into meeting_id;
  insert into public.k_meeting_participants(meeting_id,profile_id,participation_role,response_status)
  values(meeting_id,hr_id,'employee','accepted'),(meeting_id,head_id,'hr','accepted');

  -- Personal and group chats with a small, readable message history.
  insert into public.k_chats(title,created_by,is_group,created_at)
  values('Елена Морозова',hr_id,false,now()-interval '2 days') returning id into chat_id;
  insert into public.k_chat_participants(chat_id,profile_id,last_read_at)
  values(chat_id,hr_id,now()),(chat_id,manager_id,now()-interval '3 hours');
  insert into public.k_chat_messages(chat_id,author_id,body,created_at) values
    (chat_id,hr_id,'Елена, я добавил встречи по адаптации. Посмотрите, пожалуйста, расписание.',now()-interval '5 hours'),
    (chat_id,manager_id,'Вижу, спасибо. На встрече обсудим цели Ильи и Дарьи.',now()-interval '4 hours'),
    (chat_id,hr_id,'Отлично, я подготовлю короткую повестку.',now()-interval '2 hours');

  insert into public.k_chats(title,created_by,is_group,created_at)
  values('Илья Воронов',manager_id,false,now()-interval '1 day') returning id into chat_id;
  insert into public.k_chat_participants(chat_id,profile_id,last_read_at)
  values(chat_id,manager_id,now()),(chat_id,ilya_id,now()-interval '2 hours');
  insert into public.k_chat_messages(chat_id,author_id,body,created_at) values
    (chat_id,manager_id,'Илья, добавьте в ИПР задачу про проведение статус-встреч.',now()-interval '4 hours'),
    (chat_id,ilya_id,'Добавил. Буду готов провести встречу на следующей неделе.',now()-interval '3 hours');

  insert into public.k_chats(title,created_by,is_group,created_at)
  values('Команда адаптации',hr_id,true,now()-interval '18 hours') returning id into chat_id;
  insert into public.k_chat_participants(chat_id,profile_id,last_read_at)
  values(chat_id,hr_id,now()),(chat_id,manager_id,now()-interval '2 hours'),
    (chat_id,ilya_id,now()-interval '2 hours'),(chat_id,darya_id,now()-interval '2 hours');
  insert into public.k_chat_messages(chat_id,author_id,body,created_at) values
    (chat_id,hr_id,'Коллеги, здесь будем собирать вопросы по адаптации и развитию.',now()-interval '90 minutes'),
    (chat_id,darya_id,'Хорошо, я сегодня пришлю черновик аналитической записки.',now()-interval '70 minutes'),
    (chat_id,manager_id,'Спасибо! Обсудим черновик на командной встрече.',now()-interval '40 minutes');

  insert into public.k_chats(title,created_by,is_group,created_at)
  values('Олег Смирнов Семёнович',head_id,false,now()-interval '3 days') returning id into chat_id;
  insert into public.k_chat_participants(chat_id,profile_id,last_read_at)
  values(chat_id,head_id,now()),(chat_id,hr_id,now());
  insert into public.k_chat_messages(chat_id,author_id,body,created_at) values
    (chat_id,head_id,'Олег, вы назначены HR для Елены и Ильи. Все связи уже настроены.',now()-interval '2 days'),
    (chat_id,hr_id,'Принял. Начну со сверки расписания и планов развития.',now()-interval '47 hours');

  insert into public.k_notifications(recipient_id,kind,title,body,dismissible,created_at) values
    (hr_id,'meeting_reminder','Ближайшая встреча','Через три дня — сверка адаптации Елены.',true,now()-interval '1 hour'),
    (hr_id,'survey','Новый опрос','Нужно дать обратную связь об Илье Воронове.',true,now()-interval '30 minutes'),
    (manager_id,'ipr_request','Новая задача на согласовании','Илья Воронов добавил задачу в ИПР.',true,now()-interval '20 minutes'),
    (manager_id,'meeting_reminder','Командная встреча','В календаре запланирована встреча по адаптации команды.',true,now()-interval '10 minutes'),
    (ilya_id,'new_message','Новое сообщение','Елена Морозова написала вам в чате.',true,now()-interval '5 minutes');

  select id into self_template_id from public.k_survey_templates where kind='self' and is_active limit 1;
  select id into colleagues_template_id from public.k_survey_templates where kind='colleagues' and is_active limit 1;
  if self_template_id is not null then
    insert into public.k_survey_runs(template_id,subject_id,created_by,status,created_at)
    values(self_template_id,manager_id,hr_id,'active',now()-interval '1 day') returning id into survey_run_id;
    insert into public.k_survey_assignments(run_id,respondent_id) values(survey_run_id,manager_id);
  end if;
  if colleagues_template_id is not null then
    insert into public.k_survey_runs(template_id,subject_id,created_by,status,created_at)
    values(colleagues_template_id,ilya_id,hr_id,'active',now()-interval '12 hours') returning id into survey_run_id;
    insert into public.k_survey_assignments(run_id,respondent_id)
    values(survey_run_id,hr_id),(survey_run_id,manager_id);
  end if;

  return jsonb_build_object(
    'profiles',(select count(*) from public.k_profiles),
    'documents',(select count(*) from public.k_documents),
    'links',(select count(*) from public.k_resource_links),
    'chats',(select count(*) from public.k_chats),
    'meetings',(select count(*) from public.k_meetings),
    'ipr_tasks',(select count(*) from public.k_ipr_tasks)
  );
end
$$;

revoke all on function public.k_replace_demo_workspace(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.k_replace_demo_workspace(jsonb,jsonb) to service_role;
