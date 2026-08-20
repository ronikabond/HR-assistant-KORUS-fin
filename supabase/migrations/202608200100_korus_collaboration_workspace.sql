-- Shared workspace features agreed after customer review.

alter table public.k_profiles
  add column if not exists corporate_email text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists direction text not null default '';

alter table public.k_ipr_tasks
  add column if not exists is_completed boolean not null default false,
  add column if not exists completed_at timestamptz;

alter table public.k_meeting_participants
  add column if not exists response_status text not null default 'accepted'
    check (response_status in ('pending','accepted','declined'));

alter table public.k_survey_templates drop constraint if exists k_survey_templates_kind_key;
alter table public.k_survey_templates drop constraint if exists k_survey_templates_kind_check;
alter table public.k_survey_templates add column if not exists created_by uuid references public.k_profiles(id);
alter table public.k_survey_templates add column if not exists is_active boolean not null default true;
alter table public.k_survey_templates add constraint k_survey_templates_kind_check
  check (kind in ('self','colleagues','custom'));

create table if not exists public.k_demo_accounts (
  profile_id uuid primary key references public.k_profiles(id) on delete cascade,
  login text not null unique,
  demo_password text not null,
  full_name text not null,
  job_title text not null default '',
  role_label text not null default 'Сотрудник',
  is_active boolean not null default true
);

create table if not exists public.k_chats (
  id bigint generated always as identity primary key,
  title text not null,
  created_by uuid not null references public.k_profiles(id),
  is_group boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.k_chat_participants (
  chat_id bigint not null references public.k_chats(id) on delete cascade,
  profile_id uuid not null references public.k_profiles(id),
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (chat_id, profile_id)
);

alter table public.k_chat_messages add column if not exists chat_id bigint references public.k_chats(id) on delete cascade;
alter table public.k_chat_messages alter column employee_id drop not null;

create table if not exists public.k_documents (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.k_profiles(id),
  title text not null,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  access_scope text not null default 'private' check (access_scope in ('private','employee_team','people','department','office')),
  department text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.k_document_recipients (
  document_id bigint not null references public.k_documents(id) on delete cascade,
  profile_id uuid not null references public.k_profiles(id),
  primary key (document_id, profile_id)
);

create table if not exists public.k_document_hidden (
  document_id bigint not null references public.k_documents(id) on delete cascade,
  profile_id uuid not null references public.k_profiles(id),
  primary key (document_id, profile_id)
);

create table if not exists public.k_resource_links (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.k_profiles(id),
  title text not null,
  url text not null check (url ~ '^https?://'),
  description text not null default '',
  access_scope text not null default 'private' check (access_scope in ('private','employee_team','people','department','office')),
  department text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.k_resource_link_recipients (
  link_id bigint not null references public.k_resource_links(id) on delete cascade,
  profile_id uuid not null references public.k_profiles(id),
  primary key (link_id, profile_id)
);

create table if not exists public.k_resource_link_hidden (
  link_id bigint not null references public.k_resource_links(id) on delete cascade,
  profile_id uuid not null references public.k_profiles(id),
  primary key (link_id, profile_id)
);

create table if not exists public.k_survey_schedules (
  id bigint generated always as identity primary key,
  template_id bigint not null references public.k_survey_templates(id) on delete cascade,
  subject_id uuid not null references public.k_profiles(id),
  created_by uuid not null references public.k_profiles(id),
  audience text not null check (audience in ('person','colleagues','all')),
  starts_at timestamptz not null,
  frequency text not null check (frequency in ('weekly','monthly','quarterly','semiannual','yearly')),
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create index if not exists k_chat_participants_profile on public.k_chat_participants(profile_id, chat_id);
create index if not exists k_chat_messages_chat on public.k_chat_messages(chat_id, created_at);
create index if not exists k_documents_owner on public.k_documents(owner_id, created_at desc);
create index if not exists k_document_recipients_profile on public.k_document_recipients(profile_id, document_id);
create index if not exists k_links_owner on public.k_resource_links(owner_id, created_at desc);
create index if not exists k_link_recipients_profile on public.k_resource_link_recipients(profile_id, link_id);
create index if not exists k_survey_schedules_next on public.k_survey_schedules(starts_at) where is_active;

do $$
declare employee record; new_chat bigint;
begin
  for employee in select distinct m.employee_id from public.k_chat_messages m where m.chat_id is null and m.employee_id is not null
  loop
    insert into public.k_chats(title,created_by,is_group)
    select 'Сопровождение · '||p.full_name, coalesce(p.hr_id,p.manager_id,p.id), true from public.k_profiles p where p.id=employee.employee_id
    returning id into new_chat;
    insert into public.k_chat_participants(chat_id,profile_id)
      select new_chat,id from public.k_profiles where id=employee.employee_id or id=(select hr_id from public.k_profiles where id=employee.employee_id) or id=(select manager_id from public.k_profiles where id=employee.employee_id)
      on conflict do nothing;
    update public.k_chat_messages set chat_id=new_chat where employee_id=employee.employee_id and chat_id is null;
  end loop;
end $$;

create or replace function private.k_actor_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.k_profiles where id=(select auth.uid()) and is_head_hr and is_active)
$$;
revoke all on function private.k_actor_is_admin() from public;
grant execute on function private.k_actor_is_admin() to authenticated;

create or replace function private.k_is_chat_participant(target_chat bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.k_chat_participants where chat_id=target_chat and profile_id=(select auth.uid()))
$$;
revoke all on function private.k_is_chat_participant(bigint) from public;
grant execute on function private.k_is_chat_participant(bigint) to authenticated;

create or replace function private.k_can_read_document(doc public.k_documents)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists(select 1 from public.k_document_hidden h where h.document_id=doc.id and h.profile_id=(select auth.uid())) and (
    doc.owner_id=(select auth.uid()) or doc.access_scope='office' or private.k_actor_is_admin() or
    (doc.access_scope='department' and doc.department=(select department from public.k_profiles where id=(select auth.uid()))) or
    exists(select 1 from public.k_document_recipients r where r.document_id=doc.id and r.profile_id=(select auth.uid()))
  )
$$;

create or replace function private.k_can_read_link(item public.k_resource_links)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists(select 1 from public.k_resource_link_hidden h where h.link_id=item.id and h.profile_id=(select auth.uid())) and (
    item.owner_id=(select auth.uid()) or item.access_scope='office' or private.k_actor_is_admin() or
    (item.access_scope='department' and item.department=(select department from public.k_profiles where id=(select auth.uid()))) or
    exists(select 1 from public.k_resource_link_recipients r where r.link_id=item.id and r.profile_id=(select auth.uid()))
  )
$$;
revoke all on function private.k_can_read_document(public.k_documents) from public;
revoke all on function private.k_can_read_link(public.k_resource_links) from public;
grant execute on function private.k_can_read_document(public.k_documents) to authenticated;
grant execute on function private.k_can_read_link(public.k_resource_links) to authenticated;

create or replace function private.k_guard_task_self_assessment()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid())=old.employee_id and not private.k_actor_is_hr() and not private.k_is_manager_of(old.employee_id) then
    if old.status<>'approved' or (to_jsonb(new)-array['is_completed','completed_at','updated_at']) is distinct from (to_jsonb(old)-array['is_completed','completed_at','updated_at']) then
      raise exception 'Employees may only update their own completion mark';
    end if;
    new.completed_at=case when new.is_completed then coalesce(new.completed_at,now()) else null end;
  end if;
  new.updated_at=now();
  return new;
end $$;
drop trigger if exists k_guard_task_self_assessment on public.k_ipr_tasks;
create trigger k_guard_task_self_assessment before update on public.k_ipr_tasks for each row execute function private.k_guard_task_self_assessment();

create or replace function private.k_remove_empty_chat()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.k_chat_participants where chat_id=old.chat_id) < 2 then
    delete from public.k_chats where id=old.chat_id;
  end if;
  return old;
end $$;
drop trigger if exists k_remove_empty_chat on public.k_chat_participants;
create trigger k_remove_empty_chat after delete on public.k_chat_participants for each row execute function private.k_remove_empty_chat();

drop policy if exists k_tasks_self_assess on public.k_ipr_tasks;
create policy k_tasks_self_assess on public.k_ipr_tasks for update to authenticated
using (employee_id=(select auth.uid()) and status='approved')
with check (employee_id=(select auth.uid()) and status='approved');

drop policy if exists k_meetings_read on public.k_meetings;
create policy k_meetings_read on public.k_meetings for select to authenticated using (
  organizer_id=(select auth.uid()) or private.k_can_access_employee(employee_id) or
  exists(select 1 from public.k_meeting_participants p where p.meeting_id=id and p.profile_id=(select auth.uid()))
);
drop policy if exists k_meetings_add on public.k_meetings;
create policy k_meetings_add on public.k_meetings for insert to authenticated with check (
  organizer_id=(select auth.uid()) and (meeting_type='personal' or private.k_actor_is_hr() or private.k_is_manager_of(employee_id))
);
drop policy if exists k_participants_read on public.k_meeting_participants;
create policy k_participants_read on public.k_meeting_participants for select to authenticated using (
  profile_id=(select auth.uid()) or exists(select 1 from public.k_meetings m where m.id=meeting_id and (m.organizer_id=(select auth.uid()) or private.k_can_access_employee(m.employee_id)))
);
drop policy if exists k_participants_update on public.k_meeting_participants;
create policy k_participants_update on public.k_meeting_participants for update to authenticated
using (profile_id=(select auth.uid())) with check (profile_id=(select auth.uid()));
drop policy if exists k_reschedules_read on public.k_reschedule_requests;
create policy k_reschedules_read on public.k_reschedule_requests for select to authenticated using (
  requested_by=(select auth.uid()) or exists(select 1 from public.k_meetings m where m.id=meeting_id and (m.organizer_id=(select auth.uid()) or private.k_is_hr_of(m.employee_id)))
);
drop policy if exists k_reschedules_decide on public.k_reschedule_requests;
create policy k_reschedules_decide on public.k_reschedule_requests for update to authenticated using (
  exists(select 1 from public.k_meetings m where m.id=meeting_id and (m.organizer_id=(select auth.uid()) or private.k_is_hr_of(m.employee_id)))
) with check (true);

alter table public.k_demo_accounts enable row level security;
alter table public.k_chats enable row level security;
alter table public.k_chat_participants enable row level security;
alter table public.k_documents enable row level security;
alter table public.k_document_recipients enable row level security;
alter table public.k_document_hidden enable row level security;
alter table public.k_resource_links enable row level security;
alter table public.k_resource_link_recipients enable row level security;
alter table public.k_resource_link_hidden enable row level security;
alter table public.k_survey_schedules enable row level security;

create policy k_demo_accounts_public on public.k_demo_accounts for select to anon, authenticated using (is_active);
create policy k_chats_read on public.k_chats for select to authenticated using (created_by=(select auth.uid()) or private.k_is_chat_participant(id));
create policy k_chats_add on public.k_chats for insert to authenticated with check (created_by=(select auth.uid()));
create policy k_chats_delete on public.k_chats for delete to authenticated using (created_by=(select auth.uid()));
create policy k_chat_participants_read on public.k_chat_participants for select to authenticated using (private.k_is_chat_participant(chat_id));
create policy k_chat_participants_add on public.k_chat_participants for insert to authenticated with check (exists(select 1 from public.k_chats c where c.id=chat_id and c.created_by=(select auth.uid())));
create policy k_chat_participants_update on public.k_chat_participants for update to authenticated using (profile_id=(select auth.uid())) with check (profile_id=(select auth.uid()));
create policy k_chat_participants_delete on public.k_chat_participants for delete to authenticated using (profile_id=(select auth.uid()) or exists(select 1 from public.k_chats c where c.id=chat_id and c.created_by=(select auth.uid())));

drop policy if exists k_chat_read on public.k_chat_messages;
drop policy if exists k_chat_send on public.k_chat_messages;
create policy k_chat_read on public.k_chat_messages for select to authenticated using (private.k_is_chat_participant(chat_id));
create policy k_chat_send on public.k_chat_messages for insert to authenticated with check (author_id=(select auth.uid()) and private.k_is_chat_participant(chat_id));

create policy k_documents_read on public.k_documents for select to authenticated using (private.k_can_read_document(k_documents));
create policy k_documents_add on public.k_documents for insert to authenticated with check (owner_id=(select auth.uid()));
create policy k_documents_update on public.k_documents for update to authenticated using (owner_id=(select auth.uid()) or private.k_actor_is_admin()) with check (owner_id=(select auth.uid()) or private.k_actor_is_admin());
create policy k_documents_delete on public.k_documents for delete to authenticated using (owner_id=(select auth.uid()) or private.k_actor_is_admin());
create policy k_doc_recipients_read on public.k_document_recipients for select to authenticated using (profile_id=(select auth.uid()) or exists(select 1 from public.k_documents d where d.id=document_id and (d.owner_id=(select auth.uid()) or private.k_actor_is_admin())));
create policy k_doc_recipients_manage on public.k_document_recipients for all to authenticated using (exists(select 1 from public.k_documents d where d.id=document_id and (d.owner_id=(select auth.uid()) or private.k_actor_is_admin()))) with check (exists(select 1 from public.k_documents d where d.id=document_id and (d.owner_id=(select auth.uid()) or private.k_actor_is_admin())));
create policy k_doc_hidden_self on public.k_document_hidden for all to authenticated using (profile_id=(select auth.uid())) with check (profile_id=(select auth.uid()));

create policy k_links_read on public.k_resource_links for select to authenticated using (private.k_can_read_link(k_resource_links));
create policy k_links_add on public.k_resource_links for insert to authenticated with check (owner_id=(select auth.uid()) and private.k_actor_is_hr());
create policy k_links_update on public.k_resource_links for update to authenticated using (owner_id=(select auth.uid()) or private.k_actor_is_admin()) with check (owner_id=(select auth.uid()) or private.k_actor_is_admin());
create policy k_links_delete on public.k_resource_links for delete to authenticated using (owner_id=(select auth.uid()) or private.k_actor_is_admin());
create policy k_link_recipients_read on public.k_resource_link_recipients for select to authenticated using (profile_id=(select auth.uid()) or exists(select 1 from public.k_resource_links l where l.id=link_id and (l.owner_id=(select auth.uid()) or private.k_actor_is_admin())));
create policy k_link_recipients_manage on public.k_resource_link_recipients for all to authenticated using (exists(select 1 from public.k_resource_links l where l.id=link_id and (l.owner_id=(select auth.uid()) or private.k_actor_is_admin()))) with check (exists(select 1 from public.k_resource_links l where l.id=link_id and (l.owner_id=(select auth.uid()) or private.k_actor_is_admin())));
create policy k_link_hidden_self on public.k_resource_link_hidden for all to authenticated using (profile_id=(select auth.uid())) with check (profile_id=(select auth.uid()));

create policy k_schedules_read on public.k_survey_schedules for select to authenticated using (created_by=(select auth.uid()) or private.k_actor_is_admin());
create policy k_schedules_manage on public.k_survey_schedules for all to authenticated using (created_by=(select auth.uid()) or private.k_actor_is_admin()) with check ((created_by=(select auth.uid()) and private.k_actor_is_hr()) or private.k_actor_is_admin());

drop policy if exists k_notifications_insert on public.k_notifications;
create policy k_notifications_insert on public.k_notifications for insert to authenticated with check (exists(select 1 from public.k_profiles p where p.id=recipient_id and p.is_active));

insert into storage.buckets(id,name,public,file_size_limit) values ('k-documents','k-documents',false,52428800) on conflict (id) do nothing;
drop policy if exists k_document_storage_insert on storage.objects;
create policy k_document_storage_insert on storage.objects for insert to authenticated with check (bucket_id='k-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists k_document_storage_select on storage.objects;
create policy k_document_storage_select on storage.objects for select to authenticated using (bucket_id='k-documents' and exists(select 1 from public.k_documents d where d.storage_path=name and private.k_can_read_document(d)));
drop policy if exists k_document_storage_delete on storage.objects;
create policy k_document_storage_delete on storage.objects for delete to authenticated using (bucket_id='k-documents' and exists(select 1 from public.k_documents d where d.storage_path=name and (d.owner_id=(select auth.uid()) or private.k_actor_is_admin())));

grant select on public.k_demo_accounts to anon, authenticated;
grant select,insert,update,delete on public.k_chats, public.k_chat_participants, public.k_documents, public.k_document_recipients, public.k_document_hidden, public.k_resource_links, public.k_resource_link_recipients, public.k_resource_link_hidden, public.k_survey_schedules to authenticated;
grant usage,select on sequence public.k_chats_id_seq, public.k_documents_id_seq, public.k_resource_links_id_seq, public.k_survey_schedules_id_seq to authenticated;
