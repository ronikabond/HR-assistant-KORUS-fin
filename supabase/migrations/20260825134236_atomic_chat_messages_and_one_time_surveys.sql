create or replace function public.k_send_chat_message(
  p_chat_id bigint,
  p_body text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  message_body text := btrim(coalesce(p_body, ''));
  author_name text;
  chat_title text;
  message_id bigint;
begin
  if actor_id is null then
    raise exception 'Необходима авторизация';
  end if;

  if message_body = '' then
    raise exception 'Сообщение не может быть пустым';
  end if;

  if length(message_body) > 4000 then
    raise exception 'Сообщение слишком длинное';
  end if;

  select p.full_name
  into author_name
  from public.k_profiles p
  where p.id = actor_id
    and p.is_active;

  if not found then
    raise exception 'Профиль отправителя не найден';
  end if;

  select c.title
  into chat_title
  from public.k_chats c
  join public.k_chat_participants participant
    on participant.chat_id = c.id
   and participant.profile_id = actor_id
  where c.id = p_chat_id;

  if not found then
    raise exception 'Чат не найден или недоступен';
  end if;

  insert into public.k_chat_messages(chat_id, author_id, body)
  values (p_chat_id, actor_id, message_body)
  returning id into message_id;

  insert into public.k_notifications(recipient_id, kind, title, body, dismissible)
  select
    participant.profile_id,
    'new_message',
    'Новое сообщение · ' || coalesce(nullif(chat_title, ''), 'Чат'),
    author_name || ': ' || left(message_body, 120),
    true
  from public.k_chat_participants participant
  join public.k_profiles recipient
    on recipient.id = participant.profile_id
   and recipient.is_active
  where participant.chat_id = p_chat_id
    and participant.profile_id <> actor_id;

  return message_id;
end
$function$;

revoke all on function public.k_send_chat_message(bigint, text) from public, anon;
grant execute on function public.k_send_chat_message(bigint, text) to authenticated;

create or replace function public.k_send_one_time_survey(
  p_kind text,
  p_title text,
  p_description text,
  p_questions jsonb,
  p_subject_id uuid,
  p_audience text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  template_id bigint;
  run_id bigint;
begin
  if actor_id is null then
    raise exception 'Необходима авторизация';
  end if;

  if not private.k_actor_is_hr() then
    raise exception 'Создавать опросы может только HR';
  end if;

  if p_kind not in ('self', 'colleagues', 'custom') then
    raise exception 'Некорректный тип опроса';
  end if;

  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'Укажите название опроса';
  end if;

  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'Добавьте хотя бы один вопрос';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) question
    where btrim(coalesce(question->>'text', '')) = ''
       or coalesce(question->>'answer_type', '') not in ('text', 'scale')
  ) then
    raise exception 'Проверьте текст и типы вопросов';
  end if;

  insert into public.k_survey_templates(
    kind,
    title,
    description,
    created_by,
    updated_by,
    is_active
  )
  values (
    p_kind,
    btrim(p_title),
    coalesce(p_description, ''),
    actor_id,
    actor_id,
    true
  )
  returning id into template_id;

  insert into public.k_survey_questions(template_id, text, answer_type, position)
  select
    template_id,
    btrim(question.value->>'text'),
    question.value->>'answer_type',
    question.ordinality::integer
  from jsonb_array_elements(p_questions) with ordinality as question(value, ordinality);

  run_id := public.k_send_survey(template_id, p_subject_id, p_audience);

  update public.k_survey_templates
  set is_active = false,
      updated_at = now(),
      updated_by = actor_id
  where id = template_id;

  return run_id;
end
$function$;

revoke all on function public.k_send_one_time_survey(text, text, text, jsonb, uuid, text) from public, anon;
grant execute on function public.k_send_one_time_survey(text, text, text, jsonb, uuid, text) to authenticated;
