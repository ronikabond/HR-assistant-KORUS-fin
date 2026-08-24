-- The legacy record contains two adjacent spaces in its display name.  Use a
-- POSIX whitespace class so the normalization is independent of backslash
-- handling in PostgreSQL string literals.
create temporary table _k_spaced_test_profile(id uuid primary key) on commit drop;
insert into _k_spaced_test_profile(id)
select id
from public.k_profiles
where lower(regexp_replace(trim(full_name), '[[:space:]]+', ' ', 'g')) = 'тест увольнение';

delete from public.k_chats c
where c.created_by in (select id from _k_spaced_test_profile)
   or exists (
     select 1
     from public.k_chat_participants cp
     where cp.chat_id = c.id
       and cp.profile_id in (select id from _k_spaced_test_profile)
   );
delete from public.k_chat_messages where author_id in (select id from _k_spaced_test_profile);
delete from public.k_document_recipients where profile_id in (select id from _k_spaced_test_profile);
delete from public.k_document_hidden where profile_id in (select id from _k_spaced_test_profile);
delete from public.k_documents where owner_id in (select id from _k_spaced_test_profile);
delete from public.k_resource_link_recipients where profile_id in (select id from _k_spaced_test_profile);
delete from public.k_resource_link_hidden where profile_id in (select id from _k_spaced_test_profile);
delete from public.k_resource_links where owner_id in (select id from _k_spaced_test_profile);
delete from public.k_survey_schedules
where subject_id in (select id from _k_spaced_test_profile)
   or created_by in (select id from _k_spaced_test_profile);
delete from public.k_survey_runs
where subject_id in (select id from _k_spaced_test_profile)
   or created_by in (select id from _k_spaced_test_profile);
delete from public.k_survey_templates where created_by in (select id from _k_spaced_test_profile);
update public.k_survey_templates
set updated_by = null
where updated_by in (select id from _k_spaced_test_profile);
delete from public.k_reschedule_requests
where requested_by in (select id from _k_spaced_test_profile)
   or decided_by in (select id from _k_spaced_test_profile);
delete from public.k_meetings
where employee_id in (select id from _k_spaced_test_profile)
   or organizer_id in (select id from _k_spaced_test_profile);
delete from public.k_ipr_tasks
where employee_id in (select id from _k_spaced_test_profile)
   or proposed_by in (select id from _k_spaced_test_profile)
   or decided_by in (select id from _k_spaced_test_profile);
delete from public.k_notifications where recipient_id in (select id from _k_spaced_test_profile);
delete from auth.users where id in (select id from _k_spaced_test_profile);
