create or replace function private.k_is_meeting_participant(target_meeting bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.k_meeting_participants
    where meeting_id=target_meeting and profile_id=(select auth.uid())
  )
$$;

create or replace function private.k_can_manage_meeting(target_meeting bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.k_meetings m
    where m.id=target_meeting and (
      m.organizer_id=(select auth.uid()) or private.k_can_access_employee(m.employee_id)
    )
  )
$$;

revoke all on function private.k_is_meeting_participant(bigint) from public;
revoke all on function private.k_can_manage_meeting(bigint) from public;
grant execute on function private.k_is_meeting_participant(bigint) to authenticated;
grant execute on function private.k_can_manage_meeting(bigint) to authenticated;

drop policy if exists k_meetings_read on public.k_meetings;
create policy k_meetings_read on public.k_meetings for select to authenticated using (
  organizer_id=(select auth.uid()) or private.k_can_access_employee(employee_id) or private.k_is_meeting_participant(id)
);

drop policy if exists k_participants_read on public.k_meeting_participants;
create policy k_participants_read on public.k_meeting_participants for select to authenticated using (
  profile_id=(select auth.uid()) or private.k_can_manage_meeting(meeting_id)
);

drop policy if exists k_participants_add on public.k_meeting_participants;
create policy k_participants_add on public.k_meeting_participants for insert to authenticated with check (
  private.k_can_manage_meeting(meeting_id)
);

drop policy if exists k_reschedules_read on public.k_reschedule_requests;
create policy k_reschedules_read on public.k_reschedule_requests for select to authenticated using (
  requested_by=(select auth.uid()) or private.k_can_manage_meeting(meeting_id)
);

drop policy if exists k_reschedules_add on public.k_reschedule_requests;
create policy k_reschedules_add on public.k_reschedule_requests for insert to authenticated with check (
  requested_by=(select auth.uid()) and private.k_is_meeting_participant(meeting_id)
);

drop policy if exists k_reschedules_decide on public.k_reschedule_requests;
create policy k_reschedules_decide on public.k_reschedule_requests for update to authenticated using (
  private.k_can_manage_meeting(meeting_id)
) with check (true);
