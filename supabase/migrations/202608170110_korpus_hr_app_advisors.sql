-- Advisor follow-up: indexes for relationship lookups and one policy per action.
create index if not exists k_chat_author on public.k_chat_messages(author_id);
create index if not exists k_tasks_proposed_by on public.k_ipr_tasks(proposed_by);
create index if not exists k_tasks_decided_by on public.k_ipr_tasks(decided_by) where decided_by is not null;
create index if not exists k_participants_profile on public.k_meeting_participants(profile_id);
create index if not exists k_meetings_employee on public.k_meetings(employee_id);
create index if not exists k_meetings_organizer on public.k_meetings(organizer_id);
create index if not exists k_reschedules_requested_by on public.k_reschedule_requests(requested_by);
create index if not exists k_reschedules_decided_by on public.k_reschedule_requests(decided_by) where decided_by is not null;
create index if not exists k_answers_question on public.k_survey_answers(question_id);
create index if not exists k_assignments_respondent on public.k_survey_assignments(respondent_id);
create index if not exists k_questions_template on public.k_survey_questions(template_id);
create index if not exists k_runs_template on public.k_survey_runs(template_id);
create index if not exists k_runs_subject on public.k_survey_runs(subject_id);
create index if not exists k_runs_creator on public.k_survey_runs(created_by);
create index if not exists k_templates_updated_by on public.k_survey_templates(updated_by) where updated_by is not null;

drop policy if exists k_profiles_self_update on public.k_profiles;
drop policy if exists k_profiles_hr_update on public.k_profiles;
create policy k_profiles_update on public.k_profiles for update to authenticated
using (id=(select auth.uid()) or private.k_is_hr_of(id))
with check (id=(select auth.uid()) or private.k_actor_is_hr());

drop policy if exists k_templates_hr on public.k_survey_templates;
create policy k_templates_hr_insert on public.k_survey_templates for insert to authenticated with check (private.k_actor_is_hr());
create policy k_templates_hr_update on public.k_survey_templates for update to authenticated using (private.k_actor_is_hr()) with check (private.k_actor_is_hr());
create policy k_templates_hr_delete on public.k_survey_templates for delete to authenticated using (private.k_actor_is_hr());

drop policy if exists k_questions_hr on public.k_survey_questions;
create policy k_questions_hr_insert on public.k_survey_questions for insert to authenticated with check (private.k_actor_is_hr());
create policy k_questions_hr_update on public.k_survey_questions for update to authenticated using (private.k_actor_is_hr()) with check (private.k_actor_is_hr());
create policy k_questions_hr_delete on public.k_survey_questions for delete to authenticated using (private.k_actor_is_hr());
