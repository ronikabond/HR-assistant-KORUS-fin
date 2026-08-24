-- An inactive employee must no longer count as a participant. Removing the
-- membership also enforces the product rule that chats and meetings require
-- at least two people.

create or replace function private.k_enforce_meeting_minimum_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists(select 1 from public.k_meetings where id=old.meeting_id)
     and (select count(*) from public.k_meeting_participants where meeting_id=old.meeting_id)<2 then
    delete from public.k_meetings where id=old.meeting_id;
  end if;
  return old;
end
$$;

revoke all on function private.k_enforce_meeting_minimum_members() from public;

drop trigger if exists k_enforce_meeting_members_after_member on public.k_meeting_participants;
create constraint trigger k_enforce_meeting_members_after_member
after delete on public.k_meeting_participants
deferrable initially deferred
for each row execute function private.k_enforce_meeting_minimum_members();

create or replace function private.k_remove_inactive_profile_memberships()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.k_meeting_participants where profile_id=new.id;
  delete from public.k_chat_participants where profile_id=new.id;
  return new;
end
$$;

revoke all on function private.k_remove_inactive_profile_memberships() from public;

drop trigger if exists k_remove_inactive_profile_memberships on public.k_profiles;
create trigger k_remove_inactive_profile_memberships
after update of is_active on public.k_profiles
for each row
when (old.is_active and not new.is_active)
execute function private.k_remove_inactive_profile_memberships();

-- Repair rows left behind by the previous soft-delete behavior.
delete from public.k_meeting_participants mp
using public.k_profiles p
where mp.profile_id=p.id and not p.is_active;

delete from public.k_chat_participants cp
using public.k_profiles p
where cp.profile_id=p.id and not p.is_active;

delete from public.k_meetings m
where (select count(*) from public.k_meeting_participants mp where mp.meeting_id=m.id)<2;

delete from public.k_chats c
where (select count(*) from public.k_chat_participants cp where cp.chat_id=c.id)<2;

-- Remove the explicitly requested throw-away accounts and all of their test
-- history. Documents and useful links are preserved by transferring ownership
-- to the active head HR account if one of these profiles happened to own them.
create temporary table _k_requested_test_profiles(id uuid primary key) on commit drop;
insert into _k_requested_test_profiles(id)
select id
from public.k_profiles
where lower(login) ~ '^(тест|test)(111|112|[1-6])([^0-9]|$)'
   or lower(full_name) ~ '^(тест|test)(111|112|[1-6])([^0-9]|$)';

do $$
declare
  head_hr_id uuid;
begin
  select id into head_hr_id
  from public.k_profiles
  where is_active and is_head_hr
    and id not in (select id from _k_requested_test_profiles)
  order by created_at,id
  limit 1;

  if exists(
    select 1 from public.k_documents
    where owner_id in (select id from _k_requested_test_profiles)
  ) or exists(
    select 1 from public.k_resource_links
    where owner_id in (select id from _k_requested_test_profiles)
  ) then
    if head_hr_id is null then
      raise exception 'Нельзя сохранить документы и ссылки: не найден активный главный HR';
    end if;
    update public.k_documents
    set owner_id=head_hr_id,updated_at=now()
    where owner_id in (select id from _k_requested_test_profiles);
    update public.k_resource_links
    set owner_id=head_hr_id,updated_at=now()
    where owner_id in (select id from _k_requested_test_profiles);
  end if;
end
$$;

delete from public.k_chats c
where c.created_by in (select id from _k_requested_test_profiles)
   or exists(
     select 1 from public.k_chat_participants cp
     where cp.chat_id=c.id
       and cp.profile_id in (select id from _k_requested_test_profiles)
   );
delete from public.k_chat_messages where author_id in (select id from _k_requested_test_profiles);
delete from public.k_document_recipients where profile_id in (select id from _k_requested_test_profiles);
delete from public.k_document_hidden where profile_id in (select id from _k_requested_test_profiles);
delete from public.k_resource_link_recipients where profile_id in (select id from _k_requested_test_profiles);
delete from public.k_resource_link_hidden where profile_id in (select id from _k_requested_test_profiles);
delete from public.k_survey_schedules
where subject_id in (select id from _k_requested_test_profiles)
   or created_by in (select id from _k_requested_test_profiles);
delete from public.k_survey_runs
where subject_id in (select id from _k_requested_test_profiles)
   or created_by in (select id from _k_requested_test_profiles);
delete from public.k_survey_templates where created_by in (select id from _k_requested_test_profiles);
update public.k_survey_templates
set updated_by=null
where updated_by in (select id from _k_requested_test_profiles);
delete from public.k_reschedule_requests
where requested_by in (select id from _k_requested_test_profiles)
   or decided_by in (select id from _k_requested_test_profiles);
delete from public.k_meetings
where employee_id in (select id from _k_requested_test_profiles)
   or organizer_id in (select id from _k_requested_test_profiles);
delete from public.k_meeting_participants where profile_id in (select id from _k_requested_test_profiles);
delete from public.k_chat_participants where profile_id in (select id from _k_requested_test_profiles);
delete from public.k_ipr_tasks
where employee_id in (select id from _k_requested_test_profiles)
   or proposed_by in (select id from _k_requested_test_profiles)
   or decided_by in (select id from _k_requested_test_profiles);
delete from public.k_notifications where recipient_id in (select id from _k_requested_test_profiles);

delete from auth.users where id in (select id from _k_requested_test_profiles);

-- Final invariant cleanup covers chats and meetings affected indirectly by
-- the requested account removal.
delete from public.k_meetings m
where (select count(*) from public.k_meeting_participants mp where mp.meeting_id=m.id)<2;

delete from public.k_chats c
where (select count(*) from public.k_chat_participants cp where cp.chat_id=c.id)<2;
