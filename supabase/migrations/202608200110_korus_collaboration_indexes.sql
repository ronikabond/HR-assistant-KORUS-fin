create index if not exists k_chats_created_by on public.k_chats(created_by);
create index if not exists k_document_hidden_profile on public.k_document_hidden(profile_id,document_id);
create index if not exists k_link_hidden_profile on public.k_resource_link_hidden(profile_id,link_id);
create index if not exists k_schedules_creator on public.k_survey_schedules(created_by);
create index if not exists k_schedules_subject on public.k_survey_schedules(subject_id);
create index if not exists k_schedules_template on public.k_survey_schedules(template_id);
create index if not exists k_templates_created_by on public.k_survey_templates(created_by) where created_by is not null;

drop policy if exists k_doc_recipients_manage on public.k_document_recipients;
create policy k_doc_recipients_add on public.k_document_recipients for insert to authenticated with check (
  exists(select 1 from public.k_documents d where d.id=document_id and (d.owner_id=(select auth.uid()) or private.k_actor_is_admin()))
);
create policy k_doc_recipients_delete on public.k_document_recipients for delete to authenticated using (
  exists(select 1 from public.k_documents d where d.id=document_id and (d.owner_id=(select auth.uid()) or private.k_actor_is_admin()))
);

drop policy if exists k_link_recipients_manage on public.k_resource_link_recipients;
create policy k_link_recipients_add on public.k_resource_link_recipients for insert to authenticated with check (
  exists(select 1 from public.k_resource_links l where l.id=link_id and (l.owner_id=(select auth.uid()) or private.k_actor_is_admin()))
);
create policy k_link_recipients_delete on public.k_resource_link_recipients for delete to authenticated using (
  exists(select 1 from public.k_resource_links l where l.id=link_id and (l.owner_id=(select auth.uid()) or private.k_actor_is_admin()))
);

drop policy if exists k_schedules_manage on public.k_survey_schedules;
create policy k_schedules_add on public.k_survey_schedules for insert to authenticated with check (
  (created_by=(select auth.uid()) and private.k_actor_is_hr()) or private.k_actor_is_admin()
);
create policy k_schedules_update on public.k_survey_schedules for update to authenticated using (
  created_by=(select auth.uid()) or private.k_actor_is_admin()
) with check (created_by=(select auth.uid()) or private.k_actor_is_admin());
create policy k_schedules_delete on public.k_survey_schedules for delete to authenticated using (
  created_by=(select auth.uid()) or private.k_actor_is_admin()
);
