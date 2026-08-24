import { useMemo, useState } from 'react'
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek, subMonths } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, Clock, ClipboardList, Info, Plus, X } from 'lucide-react'
import type { Meeting, MeetingParticipationRole, Profile } from '../types'
import { Badge, EmptyState, Modal, PersonLine } from './UI'
import { ProfilePicker } from './ProfilePicker'
import { DateTimeField } from './DateTimeField'

const meetingColor=(meeting:Meeting,me:Profile)=>meeting.meeting_type==='deadline'?'meeting-deadline':meeting.meeting_type!=='personal'?'meeting-official':meeting.participant_statuses?.[me.id]==='pending'?'meeting-pending':'meeting-personal'
function roleFor(meeting:Meeting, me:Profile, profiles:Profile[]):MeetingParticipationRole{
  const stored=meeting.participant_roles?.[me.id]
  if(stored&&stored!=='participant')return stored
  if(meeting.employee_id===me.id)return'employee'
  const employee=profiles.find((p)=>p.id===meeting.employee_id)
  if(employee?.hr_id===me.id)return'hr'
  if(employee?.manager_id===me.id)return'manager'
  return stored??(me.is_hr?'hr':'manager')
}

const roleLabels:Record<MeetingParticipationRole,string>={employee:'как сотрудник',hr:'как HR',manager:'как руководитель',participant:'как участник'}

export function CalendarView({me,profiles,meetings,canCreate,readOnly=false,onCreate,onReschedule,onRespond,onOpenProfile}:{me:Profile;profiles:Profile[];meetings:Meeting[];canCreate:boolean;readOnly?:boolean;onCreate:(v:{title:string;employee_id:string;scheduled_for:string;participant_ids:string[];participant_roles:Record<string,MeetingParticipationRole>})=>Promise<void>;onReschedule:(meeting:Meeting,date:string,reason:string)=>Promise<void>;onRespond:(meeting:Meeting,status:'accepted'|'declined')=>Promise<void>;onOpenProfile?:(profile:Profile)=>void}){
  const [month,setMonth]=useState(new Date('2026-08-17T12:00:00'))
  const [selected,setSelected]=useState<Meeting|null>(null)
  const [createOpen,setCreateOpen]=useState(false)
  const [reschedule,setReschedule]=useState(false)
  const [legendOpen,setLegendOpen]=useState(false)
  const days=useMemo(()=>eachDayOfInterval({start:startOfWeek(startOfMonth(month),{weekStartsOn:1}),end:endOfWeek(endOfMonth(month),{weekStartsOn:1})}),[month])
  const profile=(id:string)=>profiles.find((p)=>p.id===id)
  return <section className="card calendar-card">
    <div className="section-head calendar-head"><div><span className="eyebrow">Расписание</span><h2>{format(month,'LLLL yyyy',{locale:ru})}</h2></div><div className="calendar-actions"><div className="calendar-info-wrap"><button className="icon-button calendar-info-button" aria-label="Что означают цвета" title="Что означают цвета" onClick={()=>setLegendOpen((value)=>!value)}><Info/></button>{legendOpen&&<div className="calendar-info-panel"><button aria-label="Закрыть подсказку" onClick={()=>setLegendOpen(false)}><X/></button><strong>Цвета календаря</strong><span><i className="dot official"/>Официальная встреча</span><span><i className="dot pending"/>Ждёт ответа</span><span><i className="dot personal"/>Личная подтверждённая</span><span><i className="dot deadline"/>Дедлайн</span></div>}</div><div className="segmented"><button onClick={()=>setMonth(subMonths(month,1))}><ChevronLeft/></button><button onClick={()=>setMonth(new Date())}>Сегодня</button><button onClick={()=>setMonth(addMonths(month,1))}><ChevronRight/></button></div>{canCreate&&<button className="button primary small" onClick={()=>setCreateOpen(true)}><Plus/>Встреча</button>}</div></div>
    <div className="calendar-grid"><div className="weekdays">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((d)=><span key={d}>{d}</span>)}</div><div className="calendar-days">{days.map((day)=><div key={day.toISOString()} className={`day ${!isSameMonth(day,month)?'outside':''} ${isToday(day)?'today':''}`}><time>{format(day,'d')}</time><div className="day-events">{meetings.filter((meeting)=>isSameDay(new Date(meeting.scheduled_for),day)&&meeting.participant_statuses?.[me.id]!=='declined').slice(0,4).map((meeting)=><button key={meeting.id} title={`${meeting.title} · ${format(new Date(meeting.scheduled_for),'d MMMM, HH:mm',{locale:ru})}`} className={`meeting-pill ${meetingColor(meeting,me)}`} onClick={()=>setSelected(meeting)}><span>{format(new Date(meeting.scheduled_for),'HH:mm')}</span>{meeting.title}</button>)}</div></div>)}</div></div>
    {meetings.length===0&&<EmptyState icon={<CalendarDays/>} title="Встреч пока нет" text="Когда HR будет назначен, здесь появится план адаптационных встреч."/>}
    {selected&&selected.meeting_type==='deadline'&&<Modal className="meeting-modal" title={selected.title} subtitle={`Дедлайн · ${format(new Date(selected.scheduled_for),'d MMMM yyyy, HH:mm',{locale:ru})}`} onClose={()=>setSelected(null)}>
      <div className="meeting-detail"><div className="detail-row"><ClipboardList/><div><span>Задача</span><strong>Подготовить и представить ИПР</strong></div></div>{profile(selected.employee_id)&&<PersonLine profile={profile(selected.employee_id)!} meta="Сотрудник" onClick={onOpenProfile?()=>{onOpenProfile(profile(selected.employee_id)!);setSelected(null)}:undefined}/>}{selected.organizer_id!==selected.employee_id&&selected.organizer_id!==me.id&&profile(selected.organizer_id)&&<PersonLine profile={profile(selected.organizer_id)!} meta="Ответственный" onClick={onOpenProfile?()=>{onOpenProfile(profile(selected.organizer_id)!);setSelected(null)}:undefined}/>}</div>
      <div className="modal-actions"><button className="button secondary" onClick={()=>setSelected(null)}>Закрыть</button></div>
    </Modal>}
    {selected&&selected.meeting_type!=='deadline'&&<Modal className="meeting-modal" title={selected.title} subtitle={format(new Date(selected.scheduled_for),'d MMMM yyyy, HH:mm',{locale:ru})} onClose={()=>{setSelected(null);setReschedule(false)}}>
      <div className="meeting-detail"><div className="detail-row"><Clock/><div><span>Ваша роль во встрече</span><strong>{roleLabels[roleFor(selected,me,profiles)]}</strong></div></div>{profile(selected.employee_id)&&<PersonLine profile={profile(selected.employee_id)!} meta="Сотрудник встречи" onClick={onOpenProfile?()=>{onOpenProfile(profile(selected.employee_id)!);setSelected(null)}:undefined}/>}<div className="participant-list">{selected.participant_ids?.map((id)=>profile(id)).filter(Boolean).map((p)=>{const role=selected.participant_roles?.[p!.id]??'participant';return <button type="button" key={p!.id} className="badge-button" onClick={()=>{if(onOpenProfile){onOpenProfile(p!);setSelected(null)}}}><Badge tone={role==='hr'?'purple':role==='manager'?'blue':role==='employee'?'green':'gray'}>{p!.full_name} · {roleLabels[role]}</Badge></button>})}</div></div>
      {!reschedule?<div className="modal-actions">{!readOnly&&selected.meeting_type==='personal'&&selected.organizer_id!==me.id&&selected.participant_statuses?.[me.id]==='pending'&&<><button className="button secondary" onClick={()=>void onRespond(selected,'declined').then(()=>setSelected(null))}>Отказаться</button><button className="button primary" onClick={()=>void onRespond(selected,'accepted').then(()=>setSelected(null))}>Принять</button></>}<button className="button secondary" onClick={()=>setSelected(null)}>Закрыть</button>{!readOnly&&<button className="button primary meeting-reschedule-button" onClick={()=>setReschedule(true)}><span>Предложить</span><span>дату</span></button>}</div>:<RescheduleForm meeting={selected} onSubmit={async(date,reason)=>{await onReschedule(selected,date,reason);setSelected(null)}}/>}
    </Modal>}
    {createOpen&&<CreateMeeting profiles={profiles} me={me} onClose={()=>setCreateOpen(false)} onSubmit={async(v)=>{await onCreate(v);setCreateOpen(false)}}/>}
  </section>
}

function RescheduleForm({meeting,onSubmit}:{meeting:Meeting;onSubmit:(date:string,reason:string)=>Promise<void>}){
  const[date,setDate]=useState(meeting.scheduled_for.slice(0,16));const[reason,setReason]=useState('');const[error,setError]=useState('');const[busy,setBusy]=useState(false)
  const submit=async()=>{setBusy(true);setError('');try{await onSubmit(new Date(date).toISOString(),reason)}catch(cause){setError(cause instanceof Error?cause.message:'Не удалось предложить время')}finally{setBusy(false)}}
  return <form className="form-stack" onSubmit={(e)=>{e.preventDefault();void submit()}}><label>Новая дата и время<DateTimeField type="datetime-local" value={date} onChange={setDate} required ariaLabel="Новая дата и время встречи"/></label><label>Причина<textarea value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="Коротко поясните причину"/></label>{error&&<div className="form-error" role="alert">{error}</div>}<button className="button primary" disabled={busy}>{busy?'Проверяем время…':'Отправить HR'}</button></form>
}
function CreateMeeting({profiles,me,onClose,onSubmit}:{profiles:Profile[];me:Profile;onClose:()=>void;onSubmit:(v:{title:string;employee_id:string;scheduled_for:string;participant_ids:string[];participant_roles:Record<string,MeetingParticipationRole>})=>Promise<void>}){
  const[title,setTitle]=useState('Личная встреча');const[date,setDate]=useState(new Date(Date.now()+86400000).toISOString().slice(0,16));const[participants,setParticipants]=useState<string[]>([]);const[error,setError]=useState('');const[busy,setBusy]=useState(false)
  const submit=async()=>{
    setBusy(true);setError('')
    try{
      await onSubmit({
        title,employee_id:me.id,scheduled_for:new Date(date).toISOString(),participant_ids:participants,
        participant_roles:Object.fromEntries([me.id,...participants].map((id)=>[id,id===me.id?'employee':'participant'])),
      })
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось назначить встречу')}
    finally{setBusy(false)}
  }
  return <Modal className="meeting-create-modal" title="Новая встреча" subtitle="Перед отправкой проверим расписание всех участников" onClose={onClose} wide><form className="form-stack" onSubmit={(e)=>{e.preventDefault();void submit()}}><label>Название<input value={title} onChange={(e)=>setTitle(e.target.value)} required/></label><label>Дата и время<DateTimeField type="datetime-local" value={date} onChange={setDate} required ariaLabel="Дата и время новой встречи"/></label><fieldset><legend>Пригласить сотрудников</legend><ProfilePicker profiles={profiles.filter((p)=>p.id!==me.id)} selectedIds={participants} onChange={setParticipants} multiple/></fieldset>{error&&<div className="form-error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Отмена</button><button className="button primary" disabled={busy}>{busy?'Проверяем время…':'Отправить приглашения'}</button></div></form></Modal>
}
