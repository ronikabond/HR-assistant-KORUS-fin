import { supabase } from './supabase'
import type { AccessScope, Chat, ChatMessage, DocumentItem, EmployeeDirectoryEntry, IprTask, Meeting, MeetingParticipationRole, Notification, Profile, RescheduleRequest, ResourceLink, SurveyRun, SurveySchedule, SurveyTemplate } from '../types'

const client = () => {
  if (!supabase) throw new Error('Supabase не настроен')
  return supabase
}
const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message) }
const notify=async(recipientIds:string[],kind:string,title:string,body:string)=>{const ids=[...new Set(recipientIds)].filter(Boolean);if(!ids.length)return;const{error}=await client().from('k_notifications').insert(ids.map((recipient_id)=>({recipient_id,kind,title,body,dismissible:true})));fail(error)}

export interface WorkspaceData {
  profiles: Profile[]
  chatDirectory: EmployeeDirectoryEntry[]
  tasks: IprTask[]
  meetings: Meeting[]
  reschedules: RescheduleRequest[]
  messages: ChatMessage[]
  chats: Chat[]
  notifications: Notification[]
  templates: SurveyTemplate[]
  runs: SurveyRun[]
  assignments: Array<{ run_id:number; respondent_id:string; completed_at:string|null }>
  answers: Array<{ run_id:number; respondent_id:string; question_id:number; value:string }>
  schedules: SurveySchedule[]
  documents: DocumentItem[]
  links: ResourceLink[]
}

export async function loadWorkspace(): Promise<WorkspaceData> {
  const db = client()
  const [profiles, currentProfile, chatDirectory, tasks, meetings, participants, reschedules, chats, chatParticipants, chatRoster, messages, notifications, templates, questions, runs, assignments, answers, schedules, documents, documentRecipients, links, linkRecipients] = await Promise.all([
    db.from('k_profiles').select('*').order('full_name'),
    db.rpc('k_current_profile').single(),
    db.rpc('k_chat_directory'),
    db.from('k_ipr_tasks').select('*').order('created_at'),
    db.from('k_meetings').select('*').neq('status','cancelled').order('scheduled_for'),
    db.from('k_meeting_participants').select('*'),
    db.from('k_reschedule_requests').select('*').order('created_at', { ascending:false }),
    db.from('k_chats').select('*').order('created_at'),
    db.from('k_chat_participants').select('*'),
    db.rpc('k_chat_roster'),
    db.from('k_chat_messages').select('*').order('created_at'),
    db.from('k_notifications').select('*').order('created_at', { ascending:false }),
    db.from('k_survey_templates').select('*').order('id'),
    db.from('k_survey_questions').select('*').order('position'),
    db.from('k_survey_runs').select('*').order('created_at', { ascending:false }),
    db.from('k_survey_assignments').select('*'),
    db.from('k_survey_answers').select('*'),
    db.from('k_survey_schedules').select('*').order('starts_at'),
    db.from('k_documents').select('*').order('created_at',{ascending:false}),
    db.from('k_document_recipients').select('*'),
    db.from('k_resource_links').select('*').order('created_at',{ascending:false}),
    db.from('k_resource_link_recipients').select('*'),
  ])
  for (const result of [profiles,currentProfile,chatDirectory,tasks,meetings,participants,reschedules,chats,chatParticipants,chatRoster,messages,notifications,templates,questions,runs,assignments,answers,schedules,documents,documentRecipients,links,linkRecipients]) fail(result.error)
  const participantRows = participants.data ?? []
  const chatRosterRows = (chatRoster.data ?? []) as Array<{ chat_id:number; profile_id:string; full_name:string }>
  const profileRows = (profiles.data ?? []) as Profile[]
  const self = currentProfile.data as Profile
  const visibleProfiles = profileRows.some((profile)=>profile.id===self.id) ? profileRows : [self,...profileRows]
  const templateRows = (templates.data ?? []).map((template) => ({
    ...template,
    questions:(questions.data ?? []).filter((question) => question.template_id === template.id),
  })) as SurveyTemplate[]
  return {
    profiles:visibleProfiles, chatDirectory:(chatDirectory.data ?? []) as EmployeeDirectoryEntry[], tasks:(tasks.data ?? []) as IprTask[],
    meetings:(meetings.data ?? []).map((meeting) => ({
      ...meeting,
      participant_ids:participantRows.filter((row) => row.meeting_id === meeting.id).map((row) => row.profile_id),
      participant_roles:Object.fromEntries(participantRows.filter((row) => row.meeting_id === meeting.id).map((row) => [row.profile_id,row.participation_role])),
      participant_statuses:Object.fromEntries(participantRows.filter((row) => row.meeting_id === meeting.id).map((row) => [row.profile_id,row.response_status])),
    })) as Meeting[],
    reschedules:(reschedules.data ?? []) as RescheduleRequest[],
    chats:(chats.data ?? []).map((chat)=>({
      ...chat,
      participant_ids:(chatParticipants.data??[]).filter((p)=>p.chat_id===chat.id).map((p)=>p.profile_id),
      participants:chatRosterRows.filter((person)=>person.chat_id===chat.id).map((person)=>({id:person.profile_id,full_name:person.full_name})),
      last_read_at:Object.fromEntries((chatParticipants.data??[]).filter((p)=>p.chat_id===chat.id).map((p)=>[p.profile_id,p.last_read_at])),
    })) as Chat[],
    messages:(messages.data ?? []) as ChatMessage[],
    notifications:(notifications.data ?? []) as Notification[], templates:templateRows.filter((template)=>template.is_active!==false),
    runs:(runs.data ?? []).map((run)=>({...run,template:templateRows.find((template)=>template.id===run.template_id)})) as SurveyRun[], assignments:(assignments.data ?? []), answers:(answers.data ?? []), schedules:(schedules.data??[]) as SurveySchedule[],
    documents:(documents.data??[]).map((item)=>({...item,recipient_ids:(documentRecipients.data??[]).filter((r)=>r.document_id===item.id).map((r)=>r.profile_id)})) as DocumentItem[],
    links:(links.data??[]).map((item)=>({...item,recipient_ids:(linkRecipients.data??[]).filter((r)=>r.link_id===item.id).map((r)=>r.profile_id)})) as ResourceLink[],
  }
}

export async function addTask(employeeId:string, proposedBy:string, values:Pick<IprTask,'section'|'title'|'description'|'expected_result'>, approved=false) {
  const { error } = await client().from('k_ipr_tasks').insert({
    ...values, employee_id:employeeId, proposed_by:proposedBy, status:approved ? 'approved' : 'pending',
    ...(approved ? { decided_by:proposedBy, decided_at:new Date().toISOString() } : {}),
  }); fail(error)
  if(!approved){const{data:employee}=await client().from('k_profiles').select('manager_id,full_name').eq('id',employeeId).single();if(employee?.manager_id)await notify([employee.manager_id],'ipr_task','Новая задача ИПР',`${employee.full_name} предлагает задачу «${values.title}»`)}
}
export async function decideTask(id:number, status:'approved'|'rejected', actorId:string, reason='') {
  const { error } = await client().from('k_ipr_tasks').update({ status, decided_by:actorId, decided_at:new Date().toISOString(), rejection_reason:reason || null }).eq('id',id); fail(error)
}
export async function deleteTask(id:number) { const { error } = await client().from('k_ipr_tasks').delete().eq('id',id); fail(error) }
export async function setTaskCompleted(id:number,completed:boolean) { const { error }=await client().from('k_ipr_tasks').update({is_completed:completed,completed_at:completed?new Date().toISOString():null}).eq('id',id); fail(error) }
export async function saveTelegram(_id:string, telegram_url:string) { const { error } = await client().rpc('k_update_own_telegram',{p_telegram_url:telegram_url}); fail(error) }
export async function updateEmployee(id:string, values:Partial<Profile>) { const { error } = await client().from('k_profiles').update(values).eq('id',id); fail(error) }

export async function createMeeting(values:{title:string;employee_id:string;organizer_id:string;meeting_type:string;scheduled_for:string;participant_ids:string[];participant_roles:Record<string,MeetingParticipationRole>}) {
  const { error } = await client().rpc('k_create_meeting',{
    p_title:values.title,p_employee_id:values.employee_id,p_meeting_type:values.meeting_type,
    p_scheduled_for:values.scheduled_for,p_participant_ids:values.participant_ids,
    p_participant_roles:values.participant_roles,p_duration_minutes:60,
  }); fail(error)
}
export async function requestReschedule(meetingId:number, _actorId:string, proposedFor:string, reason:string) {
  const {error}=await client().rpc('k_request_reschedule',{p_meeting_id:meetingId,p_proposed_for:proposedFor,p_reason:reason});fail(error)
}
export async function decideReschedule(request:RescheduleRequest, status:'approved'|'rejected', _actorId:string) {
  const {error}=await client().rpc('k_decide_reschedule',{p_request_id:request.id,p_status:status});fail(error)
}

export async function respondToMeeting(meetingId:number,profileId:string,status:'accepted'|'declined') { const db=client();const {error}=await db.from('k_meeting_participants').update({response_status:status}).eq('meeting_id',meetingId).eq('profile_id',profileId);fail(error);const{data:meeting}=await db.from('k_meetings').select('organizer_id,title').eq('id',meetingId).single();const{data:person}=await db.from('k_profiles').select('full_name').eq('id',profileId).single();if(meeting?.organizer_id!==profileId)await notify([meeting!.organizer_id],'meeting_response',status==='accepted'?'Встреча подтверждена':'Участник отказался',`${person?.full_name??'Участник'}: ${meeting!.title}`) }

export async function createChat(title:string,_creatorId:string,participantIds:string[]) { const{data,error}=await client().rpc('k_create_chat',{p_title:title,p_participant_ids:participantIds});fail(error);return data as number }
export async function sendMessage(chatId:number, authorId:string, body:string) { const db=client();const { error }=await db.from('k_chat_messages').insert({chat_id:chatId,author_id:authorId,body}); fail(error);const[{data:members},{data:author},{data:chat}]=await Promise.all([db.from('k_chat_participants').select('profile_id').eq('chat_id',chatId),db.from('k_profiles').select('full_name').eq('id',authorId).single(),db.from('k_chats').select('title').eq('id',chatId).single()]);await notify((members??[]).map((row)=>row.profile_id).filter((id)=>id!==authorId),'new_message',`Новое сообщение · ${chat?.title??'Чат'}`,`${author?.full_name??'Сотрудник'}: ${body.slice(0,120)}`) }
export async function markChatRead(chatId:number,profileId:string) { const {error}=await client().from('k_chat_participants').update({last_read_at:new Date().toISOString()}).eq('chat_id',chatId).eq('profile_id',profileId);fail(error) }
export async function leaveChat(chat:Chat,profileId:string) { const{error}=await client().from('k_chat_participants').delete().eq('chat_id',chat.id).eq('profile_id',profileId);fail(error) }
export async function removeChatParticipant(chat:Chat,profileId:string) { return leaveChat(chat,profileId) }
export async function readNotification(id:number) { const { error }=await client().from('k_notifications').update({is_read:true}).eq('id',id); fail(error) }
export async function deleteNotification(id:number) { const { error }=await client().from('k_notifications').delete().eq('id',id); fail(error) }

export async function sendSurvey(template:SurveyTemplate, subject:Profile, _actorId:string, _profiles:Profile[], audience:'person'|'colleagues'|'all'=template.kind==='self'?'person':'colleagues') {
  const {error}=await client().rpc('k_send_survey',{p_template_id:template.id,p_subject_id:subject.id,p_audience:audience});fail(error)
}
export async function submitSurvey(runId:number, _respondentId:string, values:Record<number,string>) {
  const {error}=await client().rpc('k_submit_survey',{p_run_id:runId,p_answers:values});fail(error)
}
export async function saveTemplate(template:SurveyTemplate) {
  const {error}=await client().rpc('k_save_survey_template',{p_template_id:template.id,p_title:template.title,p_description:template.description,p_questions:template.questions.map((q,index)=>({text:q.text,answer_type:q.answer_type,position:index+1}))});fail(error)
}
export async function createTemplate(template:Omit<SurveyTemplate,'id'>) { const{error}=await client().rpc('k_create_survey_template',{p_kind:template.kind,p_title:template.title,p_description:template.description,p_questions:template.questions.map((q,index)=>({text:q.text,answer_type:q.answer_type,position:index+1}))});fail(error) }
export async function deleteTemplate(id:number) { const{error}=await client().from('k_survey_templates').update({is_active:false}).eq('id',id);fail(error) }
export async function createSurveySchedule(values:Omit<SurveySchedule,'id'|'created_at'>) { const{error}=await client().from('k_survey_schedules').insert(values);fail(error) }
export async function deleteSurveySchedule(id:number) { const{error}=await client().from('k_survey_schedules').delete().eq('id',id);fail(error) }

type ShareValues={access_scope:AccessScope;department:string|null;recipient_ids:string[]}
const syncRecipients=async(table:string,fk:string,id:number,recipientIds:string[])=>{const db=client();const{error:del}=await db.from(table).delete().eq(fk,id);fail(del);if(recipientIds.length){const{error}=await db.from(table).insert(recipientIds.map((profile_id)=>({[fk]:id,profile_id})));fail(error)}}
export async function uploadDocument(ownerId:string,file:File,title:string,share:ShareValues){const db=client();const path=`${ownerId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Zа-яА-Я0-9._-]/g,'_')}`;const{error:uploadError}=await db.storage.from('k-documents').upload(path,file,{contentType:file.type||'application/octet-stream'});fail(uploadError);const{data,error}=await db.from('k_documents').insert({owner_id:ownerId,title,file_name:file.name,storage_path:path,mime_type:file.type||'application/octet-stream',size_bytes:file.size,access_scope:share.access_scope,department:share.department}).select('id').single();if(error){await db.storage.from('k-documents').remove([path]);fail(error)}await syncRecipients('k_document_recipients','document_id',data!.id,share.recipient_ids)}
export async function updateDocument(item:DocumentItem,values:{title:string}&ShareValues){const{error}=await client().from('k_documents').update({title:values.title,access_scope:values.access_scope,department:values.department}).eq('id',item.id);fail(error);await syncRecipients('k_document_recipients','document_id',item.id,values.recipient_ids)}
export async function hideDocument(id:number,profileId:string){const{error}=await client().from('k_document_hidden').upsert({document_id:id,profile_id:profileId});fail(error)}
export async function deleteDocumentEverywhere(item:DocumentItem){const db=client();const{error:storageError}=await db.storage.from('k-documents').remove([item.storage_path]);fail(storageError);const{error}=await db.from('k_documents').delete().eq('id',item.id);fail(error)}
export async function openDocument(item:DocumentItem,download=false){const{data,error}=await client().storage.from('k-documents').createSignedUrl(item.storage_path,120,{download:download?item.file_name:undefined});fail(error);if(!data?.signedUrl)throw new Error('Не удалось открыть файл');if(!download&&(item.mime_type==='text/uri-list'||item.file_name.toLowerCase().endsWith('.url'))){const response=await fetch(data.signedUrl);if(!response.ok)throw new Error('Не удалось прочитать ссылку');const target=new URL((await response.text()).trim());if(!['http:','https:'].includes(target.protocol))throw new Error('Недопустимый адрес ссылки');window.open(target.toString(),'_blank','noopener,noreferrer');return}window.open(data.signedUrl,'_blank','noopener,noreferrer')}

export async function createLink(ownerId:string,values:{title:string;url:string;description:string}&ShareValues){const db=client();const{data,error}=await db.from('k_resource_links').insert({owner_id:ownerId,title:values.title,url:values.url,description:values.description,access_scope:values.access_scope,department:values.department}).select('id').single();fail(error);await syncRecipients('k_resource_link_recipients','link_id',data!.id,values.recipient_ids)}
export async function updateLink(item:ResourceLink,values:{title:string;url:string;description:string}&ShareValues){const{error}=await client().from('k_resource_links').update({title:values.title,url:values.url,description:values.description,access_scope:values.access_scope,department:values.department}).eq('id',item.id);fail(error);await syncRecipients('k_resource_link_recipients','link_id',item.id,values.recipient_ids)}
export async function hideLink(id:number,profileId:string){const{error}=await client().from('k_resource_link_hidden').upsert({link_id:id,profile_id:profileId});fail(error)}
export async function deleteLinkEverywhere(id:number){const{error}=await client().from('k_resource_links').delete().eq('id',id);fail(error)}

export async function listDemoAccounts(){if(!supabase)return[];const{data,error}=await supabase.from('k_demo_accounts').select('login,demo_password,full_name,job_title,role_label').eq('is_active',true).order('full_name');fail(error);return data??[]}
export async function markAllNotificationsRead(recipientId:string){const{error}=await client().from('k_notifications').update({is_read:true}).eq('recipient_id',recipientId).eq('is_read',false);fail(error)}

export async function employeeAdmin(action:'create'|'delete', payload:Record<string,unknown>) {
  const db=client(); const { data:{session} }=await db.auth.getSession()
  const { data,error }=await db.functions.invoke('k-employee-admin',{body:{action,...payload},headers:session?{Authorization:`Bearer ${session.access_token}`}:{}}); fail(error)
  if(data?.error) throw new Error(data.error)
  return data
}
