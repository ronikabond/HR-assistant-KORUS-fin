-- Chat creation needs a company-wide directory without exposing full profiles.
create or replace function public.k_chat_directory()
returns table(id uuid, full_name text, job_title text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.k_profiles p where p.id=(select auth.uid()) and p.is_active
  ) then
    raise exception 'Необходима авторизация';
  end if;

  return query
  select p.id, p.full_name, p.job_title
  from public.k_profiles p
  where p.is_active
  order by p.full_name;
end
$$;

revoke all on function public.k_chat_directory() from public, anon;
grant execute on function public.k_chat_directory() to authenticated;

-- Any authenticated employee may start a chat with any active employee.
-- Full profile visibility remains governed by the existing profile RLS rules.
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
