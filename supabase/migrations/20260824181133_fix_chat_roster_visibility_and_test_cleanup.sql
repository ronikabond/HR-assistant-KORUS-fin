-- A chat is visible only while the current user is a participant.  The
-- creator flag must not keep a chat visible after the creator has left it.
drop policy if exists k_chats_read on public.k_chats;
create policy k_chats_read on public.k_chats
for select to authenticated
using (private.k_is_chat_participant(id));

-- Profile RLS intentionally hides unrelated employees.  Chat participants
-- still need the names of people who share a chat with them, so expose the
-- smallest possible roster through a scoped function instead of broadening
-- profile access.
create or replace function public.k_chat_roster()
returns table(chat_id bigint, profile_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select cp.chat_id, cp.profile_id, p.full_name
  from public.k_chat_participants cp
  join public.k_profiles p on p.id = cp.profile_id
  where (select auth.uid()) is not null
    and exists (
      select 1
      from public.k_chat_participants own
      where own.chat_id = cp.chat_id
        and own.profile_id = (select auth.uid())
    )
$$;

revoke all on function public.k_chat_roster() from public, anon;
grant execute on function public.k_chat_roster() to authenticated;

-- Remove the remaining review-only accounts that were already inactive but
-- still left personal chats in the production workspace.
create temporary table _k_remaining_test_profiles(id uuid primary key) on commit drop;
insert into _k_remaining_test_profiles(id)
select id
from public.k_profiles
where lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g')) in (
  'дедлайн тестова',
  'коллизия тестова а',
  'коллизия тестова б',
  'тест увольнение',
  'финальная проверка'
);

delete from public.k_chats c
where c.created_by in (select id from _k_remaining_test_profiles)
   or exists (
     select 1
     from public.k_chat_participants cp
     where cp.chat_id = c.id
       and cp.profile_id in (select id from _k_remaining_test_profiles)
   );
delete from public.k_chat_messages where author_id in (select id from _k_remaining_test_profiles);
delete from public.k_document_recipients where profile_id in (select id from _k_remaining_test_profiles);
delete from public.k_document_hidden where profile_id in (select id from _k_remaining_test_profiles);
delete from public.k_documents where owner_id in (select id from _k_remaining_test_profiles);
delete from public.k_resource_link_recipients where profile_id in (select id from _k_remaining_test_profiles);
delete from public.k_resource_link_hidden where profile_id in (select id from _k_remaining_test_profiles);
delete from public.k_resource_links where owner_id in (select id from _k_remaining_test_profiles);
delete from public.k_survey_schedules
where subject_id in (select id from _k_remaining_test_profiles)
   or created_by in (select id from _k_remaining_test_profiles);
delete from public.k_survey_runs
where subject_id in (select id from _k_remaining_test_profiles)
   or created_by in (select id from _k_remaining_test_profiles);
delete from public.k_survey_templates where created_by in (select id from _k_remaining_test_profiles);
update public.k_survey_templates
set updated_by = null
where updated_by in (select id from _k_remaining_test_profiles);
delete from public.k_reschedule_requests
where requested_by in (select id from _k_remaining_test_profiles)
   or decided_by in (select id from _k_remaining_test_profiles);
delete from public.k_meetings
where employee_id in (select id from _k_remaining_test_profiles)
   or organizer_id in (select id from _k_remaining_test_profiles);
delete from public.k_ipr_tasks
where employee_id in (select id from _k_remaining_test_profiles)
   or proposed_by in (select id from _k_remaining_test_profiles)
   or decided_by in (select id from _k_remaining_test_profiles);
delete from public.k_notifications where recipient_id in (select id from _k_remaining_test_profiles);
delete from auth.users where id in (select id from _k_remaining_test_profiles);
