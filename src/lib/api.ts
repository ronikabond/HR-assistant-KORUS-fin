import { supabase } from './supabase'
import type { AccessScope, Chat, ChatMessage, DocumentItem, IprTask, Meeting, MeetingParticipationRole, Notification, Profile, RescheduleRequest, ResourceLink, SurveyRun, SurveySchedule, SurveyTemplate } from '../types'

const client = () => {
  if (!supabase) throw new Error('Supabase не настроен')
  return supabase
}
const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message) }
const notify=async(recipientIds:string[],kind:string,title:string,body:string)=>{const ids=[...new Set(recipientIds)].filter(Boolean);if(!ids.length)return;const{error}=await client().from('k_notifications').insert(ids.map((recipient_id)=>({recipient_id,kind,title,body,dismissible:true})));fail(error)}

export interface WorkspaceData {
  profiles: Profile[]
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
  const [profiles, tasks, meetings, participants, reschedules, chats, chatParticipants, messages, notifications, templates, questions, runs, assignments, answers, schedules, documents, documentRecipients, links, linkRecipients] = await Promise.all([
    db.from('k_profiles').select('*').order('full_name'),
    db.from('k_ipr_tasks').select('*').order('created_at'),
    db.from('k_meetings').select('*').neq('status','cancelled').order('scheduled_for'),
    db.from('k_meeting_participants').select('*'),
    db.from('k_reschedule_requests').select('*').order('created_at', { ascending:false }),
    db.from('k_chats').select('*').order('created_at'),
    db.from('k_chat_participants').select('*'),
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
  for (const result of [profiles,tasks,meetings,participants,reschedules,chats,chatParticipants,messages,notifications,templates,questions,runs,assignments,answers,schedules,documents,documentRecipients,links,linkRecipients]) fail(result.error)
  const participantRows = participants.data ?? []
  const templateRows = (templates.data ?? []).map((template) => ({
    ...template,
    questions:(questions.data ?? []).filter((question) => question.template_id === template.id),
  })) as SurveyTemplate[]
  return {
    profiles:(profiles.data ?? []) as Profile[], tasks:(tasks.data ?? []) as IprTask[],
    meetings:(meetings.data ?? []).map((meeting) => ({
      ...meeting,
      participant_ids:participantRows.filter((row) => row.meeting_id === meeting.id).map((row) => row.profile_id),
      participant_roles:Object.fromEntries(participantRows.filter((row) => row.meeting_id === meeting.id).map((row) => [row.profile_id,row.participation_role])),
      participant_statuses:Object.fromEntries(participantRows.filter((row) => row.meeting_id === meeting.id).map((row) => [row.profile_id,row.response_status])),
    })) as Meeting[],
    reschedules:(reschedules.data ?? []) as RescheduleRequest[],
    chats:(chats.data ?? []).map((chat)=>({...chat,participant_ids:(chatParticipants.data??[]).filter((p)=>p.chat_id===chat.id).map((p)=>p.profile_id),last_read_at:Object.fromEntries((chatParticipants.data??[]).filter((p)=>p.chat_id===chat.id).map((p)=>[p.profile_id,p.last_read_at]))})) as Chat[],
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
export async function saveTelegram(id:string, telegram_url:string) { const { error } = await client().from('k_profiles').update({telegram_url}).eq('id',id); fail(error) }
export async function updateEmployee(id:string, values:Partial<Profile>) { const { error } = await client().from('k_profiles').update(values).eq('id',id); fail(error) }

export async function createMeeting(values:{title:string;employee_id:string;organizer_id:string;meeting_type:string;scheduled_for:string;participant_ids:string[];participant_roles:Record<string,MeetingParticipationRole>}) {
  const { participant_ids, participant_roles, ...meeting } = values
  const { data, error } = await client().from('k_meetings').insert(meeting).select('id').single(); fail(error)
  const unique = [...new Set([values.employee_id,values.organizer_id,...participant_ids])]
  const { error: participantError } = await client().from('k_meeting_participants').insert(unique.map((profile_id) => ({meeting_id:data!.id,profile_id,participation_role:participant_roles[profile_id]??'participant',response_status:values.meeting_type==='personal'&&profile_id!==values.organizer_id?'pending':'accepted'}))); fail(participantError)
  await notify(unique.filter((id)=>id!==values.organizer_id),'meeting_invite','Приглашение на встречу',`${values.title} · ${new Date(values.scheduled_for).toLocaleString('ru-RU')}`)
}
export async function requestReschedule(meetingId:number, actorId:string, proposedFor:string, reason:string) {
  const db=client(); const { error }=await db.from('k_reschedule_requests').insert({meeting_id:meetingId,requested_by:actorId,proposed_for:proposedFor,reason}); fail(error)
  const { error:updateError }=await db.from('k_meetings').update({status:'reschedule_requested'}).eq('id',meetingId); if(updateError && updateError.code!=='42501') throw new Error(updateError.message)
  const{data:meeting}=await db.from('k_meetings').select('organizer_id,title').eq('id',meetingId).single();if(meeting?.organizer_id!==actorId)await notify([meeting!.organizer_id],'reschedule_request','Запрос на перенос',`${meeting!.title}: предложена новая дата`)
}
export async function decideReschedule(request:RescheduleRequest, status:'approved'|'rejected', actorId:string) {
  const db=client(); const { error }=await db.from('k_reschedule_requests').update({status,decided_by:actorId,decided_at:new Date().toISOString()}).eq('id',request.id); fail(error)
  const patch=status==='approved'?{scheduled_for:request.proposed_for,status:'planned'}:{status:'planned'}
  const { error:meetingError }=await db.from('k_meetings').update(patch).eq('id',request.meeting_id); fail(meetingError)
  await notify([request.requested_by],'reschedule_decision',status==='approved'?'Перенос подтверждён':'Перенос отклонён',status==='approved'?'Новая дата встречи сохранена у участников':'Встреча остаётся в прежнее время')
}

export async function respondToMeeting(meetingId:number,profileId:string,status:'accepted'|'declined') { const db=client();const {error}=await db.from('k_meeting_participants').update({response_status:status}).eq('meeting_id',meetingId).eq('profile_id',profileId);fail(error);const{data:meeting}=await db.from('k_meetings').select('organizer_id,title').eq('id',meetingId).single();const{data:person}=await db.from('k_profiles').select('full_name').eq('id',profileId).single();if(meeting?.organizer_id!==profileId)await notify([meeting!.organizer_id],'meeting_response',status==='accepted'?'Встреча подтверждена':'Участник отказался',`${person?.full_name??'Участник'}: ${meeting!.title}`) }

export async function createChat(title:string,creatorId:string,participantIds:string[]) { const db=client();const{data,error}=await db.from('k_chats').insert({title,created_by:creatorId,is_group:participantIds.length>1}).select('*').single();fail(error);const ids=[...new Set([creatorId,...participantIds])];const{error:participantError}=await db.from('k_chat_participants').insert(ids.map((profile_id)=>({chat_id:data!.id,profile_id,last_read_at:profile_id===creatorId?new Date().toISOString():null})));fail(participantError);await notify(ids.filter((id)=>id!==creatorId),'new_chat','Новый чат',title);return data as Chat }
export async function sendMessage(chatId:number, authorId:string, body:string) { const db=client();const { error }=await db.from('k_chat_messages').insert({chat_id:chatId,author_id:authorId,body}); fail(error);const[{data:members},{data:author},{data:chat}]=await Promise.all([db.from('k_chat_participants').select('profile_id').eq('chat_id',chatId),db.from('k_profiles').select('full_name').eq('id',authorId).single(),db.from('k_chats').select('title').eq('id',chatId).single()]);await notify((members??[]).map((row)=>row.profile_id).filter((id)=>id!==authorId),'new_message',`Новое сообщение · ${chat?.title??'Чат'}`,`${author?.full_name??'Сотрудник'}: ${body.slice(0,120)}`) }
export async function markChatRead(chatId:number,profileId:string) { const {error}=await client().from('k_chat_participants').update({last_read_at:new Date().toISOString()}).eq('chat_id',chatId).eq('profile_id',profileId);fail(error) }
export async function leaveChat(chat:Chat,profileId:string) { const{error}=await client().from('k_chat_participants').delete().eq('chat_id',chat.id).eq('profile_id',profileId);fail(error) }
export async function removeChatParticipant(chat:Chat,profileId:string) { return leaveChat(chat,profileId) }
export async function readNotification(id:number) { const { error }=await client().from('k_notifications').update({is_read:true}).eq('id',id); fail(error) }
export async function deleteNotification(id:number) { const { error }=await client().from('k_notifications').delete().eq('id',id); fail(error) }

export async function sendSurvey(template:SurveyTemplate, subject:Profile, actorId:string, profiles:Profile[], audience:'person'|'colleagues'|'all'=template.kind==='self'?'person':'colleagues') {
  const db=client(); const { data:run,error }=await db.from('k_survey_runs').insert({template_id:template.id,subject_id:subject.id,created_by:actorId}).select('*').single(); fail(error)
  const recipients=audience==='person'?[subject]:audience==='all'?profiles.filter((profile)=>profile.id!==subject.id):profiles.filter((p)=>p.id!==subject.id && (p.department===subject.department || p.id===subject.manager_id))
  const { error:assignmentError }=await db.from('k_survey_assignments').insert([...new Map(recipients.map((p)=>[p.id,p])).values()].map((p)=>({run_id:run!.id,respondent_id:p.id}))); fail(assignmentError)
  await notify(recipients.map((profile)=>profile.id),'new_survey','Новый опрос',`${template.title} · о сотруднике ${subject.full_name}`)
}
export async function submitSurvey(runId:number, respondentId:string, values:Record<number,string>) {
  const db=client(); const rows=Object.entries(values).map(([question_id,value])=>({run_id:runId,respondent_id:respondentId,question_id:Number(question_id),value}))
  const { error }=await db.from('k_survey_answers').upsert(rows); fail(error)
  const { error:completeError }=await db.from('k_survey_assignments').update({completed_at:new Date().toISOString()}).eq('run_id',runId).eq('respondent_id',respondentId); fail(completeError)
}
export async function saveTemplate(template:SurveyTemplate) {
  const db=client(); const { error }=await db.from('k_survey_templates').update({title:template.title,description:template.description}).eq('id',template.id); fail(error)
  const { error:deleteError }=await db.from('k_survey_questions').delete().eq('template_id',template.id); fail(deleteError)
  const { error:insertError }=await db.from('k_survey_questions').insert(template.questions.map((q,index)=>({template_id:template.id,text:q.text,answer_type:q.answer_type,position:index+1}))); fail(insertError)
}
export async function createTemplate(template:Omit<SurveyTemplate,'id'>) { const db=client();const{data,error}=await db.from('k_survey_templates').insert({kind:template.kind,title:template.title,description:template.description,is_active:true}).select('id').single();fail(error);const{error:qError}=await db.from('k_survey_questions').insert(template.questions.map((q,index)=>({template_id:data!.id,text:q.text,answer_type:q.answer_type,position:index+1})));fail(qError) }
export async function deleteTemplate(id:number) { const{error}=await client().from('k_survey_templates').update({is_active:false}).eq('id',id);fail(error) }
export async function createSurveySchedule(values:Omit<SurveySchedule,'id'|'created_at'>) { const{error}=await client().from('k_survey_schedules').insert(values);fail(error) }
export async function deleteSurveySchedule(id:number) { const{error}=await client().from('k_survey_schedules').delete().eq('id',id);fail(error) }

type ShareValues={access_scope:AccessScope;department:string|null;recipient_ids:string[]}
const syncRecipients=async(table:string,fk:string,id:number,recipientIds:string[])=>{const db=client();const{error:del}=await db.from(table).delete().eq(fk,id);fail(del);if(recipientIds.length){const{error}=await db.from(table).insert(recipientIds.map((profile_id)=>({[fk]:id,profile_id})));fail(error)}}
export async function uploadDocument(ownerId:string,file:File,title:string,share:ShareValues){const db=client();const path=`${ownerId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Zа-яА-Я0-9._-]/g,'_')}`;const{error:uploadError}=await db.storage.from('k-documents').upload(path,file,{contentType:file.type||'application/octet-stream'});fail(uploadError);const{data,error}=await db.from('k_documents').insert({owner_id:ownerId,title,file_name:file.name,storage_path:path,mime_type:file.type||'application/octet-stream',size_bytes:file.size,access_scope:share.access_scope,department:share.department}).select('id').single();if(error){await db.storage.from('k-documents').remove([path]);fail(error)}await syncRecipients('k_document_recipients','document_id',data!.id,share.recipient_ids)}
export async function updateDocument(item:DocumentItem,values:{title:string}&ShareValues){const{error}=await client().from('k_documents').update({title:values.title,access_scope:values.access_scope,department:values.department}).eq('id',item.id);fail(error);await syncRecipients('k_document_recipients','document_id',item.id,values.recipient_ids)}
export async function hideDocument(id:number,profileId:string){const{error}=await client().from('k_document_hidden').upsert({document_id:id,profile_id:profileId});fail(error)}
export async function deleteDocumentEverywhere(item:DocumentItem){const db=client();const{error:storageError}=await db.storage.from('k-documents').remove([item.storage_path]);fail(storageError);const{error}=await db.from('k_documents').delete().eq('id',item.id);fail(error)}
export async function openDocument(item:DocumentItem,download=false){const{data,error}=await client().storage.from('k-documents').createSignedUrl(item.storage_path,120,{download:download?item.file_name:undefined});fail(error);if(!data?.signedUrl)throw new Error('Не удалось открыть файл');window.open(data.signedUrl,'_blank','noopener,noreferrer')}

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
