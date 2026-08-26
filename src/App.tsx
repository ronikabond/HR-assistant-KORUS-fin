import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Bell, BookOpen, CalendarDays, CheckCircle2, ClipboardList, FileText, Home, Link2, LogOut, Menu, MessageSquareText, Moon, RefreshCw, Sparkles, Sun, UserRound, Users, X } from 'lucide-react'
import { supabase, isSupabaseConfigured, loginToEmail } from './lib/supabase'
import * as api from './lib/api'
import type { Meeting, Profile, ViewName } from './types'
import { LoginPage } from './pages/LoginPage'
import { CalendarView } from './components/CalendarView'
import { OnboardingStepper } from './components/OnboardingStepper'
import { IprView } from './components/IprView'
import { Avatar, Badge, EmptyState, Modal } from './components/UI'
import { PeoplePage } from './pages/PeoplePage'
import { TeamPage } from './pages/TeamPage'
import { SurveysPage } from './pages/SurveysPage'
import { ChatsPage } from './pages/ChatsPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { LinksPage } from './pages/LinksPage'

const emptyData:api.WorkspaceData={profiles:[],chatDirectory:[],assignmentDirectory:[],tasks:[],meetings:[],reschedules:[],messages:[],chats:[],notifications:[],templates:[],runs:[],assignments:[],answers:[],schedules:[],documents:[],links:[]}
type Theme='light'|'dark'
const profileNameParts=(fullName:string)=>{const[firstName='',lastName='',...middle]=fullName.trim().split(/\s+/);return{firstName,lastName,middleName:middle.join(' ')}}

export default function App(){
  const[session,setSession]=useState<Session|null>(null);const[data,setData]=useState(emptyData);const[view,setView]=useState<ViewName>('home');const[loading,setLoading]=useState(true);const[loadedFor,setLoadedFor]=useState<string|null>(null);const[loginBusy,setLoginBusy]=useState(false);const[error,setError]=useState('');const[toast,setToast]=useState('');const[notificationsOpen,setNotificationsOpen]=useState(false);const[profileOpen,setProfileOpen]=useState(false);const[selectedEmployee,setSelectedEmployee]=useState<Profile|null>(null);const[mobileMenuOpen,setMobileMenuOpen]=useState(false);const[theme,setTheme]=useState<Theme>(()=>(localStorage.getItem('korus-theme') as Theme)|| (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'))
  const userId=session?.user.id??null
  const me=data.profiles.find((profile)=>profile.id===userId)??null
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('korus-theme',theme)},[theme])
  useEffect(()=>{if(!mobileMenuOpen)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setMobileMenuOpen(false)};document.body.classList.add('mobile-menu-visible');window.addEventListener('keydown',close);return()=>{document.body.classList.remove('mobile-menu-visible');window.removeEventListener('keydown',close)}},[mobileMenuOpen])
  const refreshing=useRef(false);const refreshQueued=useRef(false);const authenticatedUserId=useRef<string|null>(null);const pageContentRef=useRef<HTMLDivElement>(null)
  useEffect(()=>{pageContentRef.current?.scrollTo({top:0});window.scrollTo({top:0})},[view,selectedEmployee])
  const refresh=useCallback(async()=>{
    if(!userId)return
    if(refreshing.current){refreshQueued.current=true;return}
    refreshing.current=true
    try{
      do{
        refreshQueued.current=false
        setData(await api.loadWorkspace());setError('')
      }while(refreshQueued.current)
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось загрузить данные')}
    finally{refreshing.current=false;setLoadedFor(userId);setLoading(false)}
  },[userId])
  useEffect(()=>{if(!supabase){setLoading(false);return}void supabase.auth.getSession().then(({data:{session:next}})=>{authenticatedUserId.current=next?.user.id??null;setSession(next);if(!next)setLoading(false)});const{data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{const nextUserId=next?.user.id??null;const userChanged=authenticatedUserId.current!==nextUserId;authenticatedUserId.current=nextUserId;if(userChanged)setLoading(Boolean(next));setSession(next)});return()=>subscription.unsubscribe()},[])
  useEffect(()=>{if(userId)void refresh();else{setData(emptyData);setLoadedFor(null)}},[userId,refresh])
  useEffect(()=>{
    if(!supabase||!userId)return
    let debounce:ReturnType<typeof setTimeout>|null=null
    const channel=supabase.channel(`korus-${userId}`).on('postgres_changes',{event:'*',schema:'public'},()=>{
      if(debounce)clearTimeout(debounce)
      debounce=setTimeout(()=>void refresh(),400)
    }).subscribe()
    return()=>{if(debounce)clearTimeout(debounce);void supabase?.removeChannel(channel)}
  },[userId,refresh])
  const runAction=async(action:()=>Promise<void>,message:string,rethrow:boolean)=>{try{await action();await refresh();if(message)setToast(message)}catch(cause){setToast(cause instanceof Error?cause.message:'Произошла ошибка');if(rethrow)throw cause}finally{setTimeout(()=>setToast(''),3500)}}
  const act=(action:()=>Promise<void>,message='Сохранено')=>runAction(action,message,false)
  const actStrict=(action:()=>Promise<void>,message='Сохранено')=>runAction(action,message,true)
  const login=async(login:string,password:string)=>{if(!supabase)return;setLoginBusy(true);setError('');const{error:authError}=await supabase.auth.signInWithPassword({email:loginToEmail(login),password});if(authError)setError('Неверный логин или пароль');setLoginBusy(false)}
  const logout=async()=>{try{await supabase?.auth.signOut({scope:'local'})}catch(cause){void cause}setView('home');setSelectedEmployee(null);setProfileOpen(false)}

  if(!isSupabaseConfigured)return <div className="setup-screen"><Sparkles/><h1>Подключите Supabase</h1><p>Добавьте публичные параметры проекта в переменные окружения.</p></div>
  if(!session)return <LoginPage onLogin={login} busy={loginBusy} error={error} theme={theme} onToggleTheme={()=>setTheme(theme==='light'?'dark':'light')}/>
  if(loading||loadedFor!==userId)return <div className="loading-screen"><span/><b>Собираем ваше пространство…</b></div>
  if(!me)return <div className="setup-screen"><UserRound/><h1>{error?'Не удалось загрузить профиль':'Профиль не найден'}</h1>{error&&<p className="setup-error">{error}</p>}<div className="setup-actions">{error&&<button className="button primary" onClick={()=>void refresh()}><RefreshCw/>Повторить</button>}<button className={`button ${error?'secondary':'primary'}`} onClick={()=>void logout()}>Выйти</button></div></div>

  const isManager=data.profiles.some((profile)=>profile.manager_id===me.id);const unread=data.notifications.filter((item)=>!item.is_read).length
  const chatUnread=data.chats.reduce((sum,chat)=>sum+data.messages.filter((message)=>message.chat_id===chat.id&&message.author_id!==me.id&&(!chat.last_read_at?.[me.id]||message.created_at>chat.last_read_at[me.id]!)).length,0)
  const nav:Array<{id:ViewName;label:string;icon:typeof Home;show:boolean;count?:number}>=[
    {id:'home',label:'Главная',icon:Home,show:true},{id:'calendar',label:'Календарь',icon:CalendarDays,show:true},{id:'ipr',label:'Мой ИПР',icon:BookOpen,show:true},{id:'team',label:'Моя команда',icon:Users,show:isManager},{id:'people',label:'Сотрудники',icon:UserRound,show:me.is_hr},{id:'surveys',label:'Опросы',icon:ClipboardList,show:true,count:data.assignments.filter((a)=>a.respondent_id===me.id&&!a.completed_at).length},{id:'chats',label:'Чаты',icon:MessageSquareText,show:true,count:chatUnread},{id:'documents',label:'Документы',icon:FileText,show:true},{id:'links',label:'Полезные ссылки',icon:Link2,show:true},
  ]
  const ownMeetings=data.meetings.filter((meeting)=>meeting.participant_ids?.includes(me.id)||(meeting.employee_id===me.id&&meeting.meeting_type!=='deadline')||meeting.organizer_id===me.id)
  const ipr=(employee:Profile,readOnly=false,showAddAction=false)=> <IprView employee={employee} me={me} tasks={data.tasks.filter((task)=>task.employee_id===employee.id)} readOnly={readOnly} showAddAction={showAddAction} onAdd={(values)=>act(()=>api.addTask(employee.id,me.id,values,employee.id!==me.id),'Задача сохранена')} onDecide={(task,status,reason)=>act(()=>api.decideTask(task.id,status,me.id,reason),'Решение сохранено')} onDelete={(task)=>act(()=>api.deleteTask(task.id),'Задача удалена')} onComplete={(task,completed)=>act(()=>api.setTaskCompleted(task.id,completed),'Прогресс обновлён')}/>
  const calendar=(readOnly=false)=><CalendarView me={me} profiles={data.profiles} meetings={ownMeetings} canCreate={!readOnly} readOnly={readOnly} onCreate={(values)=>actStrict(()=>api.createMeeting({...values,organizer_id:me.id,meeting_type:'personal'}),'Приглашения отправлены')} onReschedule={(meeting,date,reason)=>actStrict(()=>api.requestReschedule(meeting.id,me.id,date,reason),'Новая дата предложена')} onRespond={(meeting,status)=>act(()=>api.respondToMeeting(meeting.id,me.id,status),status==='accepted'?'Встреча подтверждена':'Встреча убрана из календаря')} onOpenProfile={setSelectedEmployee}/>
  const page=()=>{
    if(selectedEmployee)return <><button className="back-link" onClick={()=>setSelectedEmployee(null)}>← Назад</button><EmployeeOverview person={selectedEmployee} profiles={data.profiles} meetings={data.meetings} onChat={()=>setView('chats')}/>{ipr(selectedEmployee)}</>
    switch(view){
      case'home':return <HomePage me={me} data={data} calendar={calendar(true)} ipr={ipr(me,true,true)}/>
      case'calendar':return <><PageTitle eyebrow="Расписание" title="Календарь" text="Официальные и личные встречи в одном месте."/>{calendar()}{me.is_hr&&<RescheduleApprovals me={me} data={data} act={act}/>}</>
      case'ipr':return <><PageTitle eyebrow="Развитие" title="Мой ИПР" text="Отмечайте выполненное — руководитель увидит общий прогресс."/>{ipr(me)}</>
      case'people':return <PeoplePage me={me} profiles={data.profiles} assignmentDirectory={data.assignmentDirectory} meetings={data.meetings} renderIpr={(employee)=>ipr(employee)} onChat={()=>setView('chats')} onCreate={(employee)=>act(()=>api.employeeAdmin('create',{employee}),'Аккаунт создан и добавлен в тестовый вход')} onUpdate={(id,values)=>act(()=>api.updateEmployee(id,values),'Профиль обновлён')} onDelete={(id)=>act(()=>api.employeeAdmin('delete',{id}),'Сотрудник уволен; история опросов сохранена')} onImportOne={(employee)=>api.employeeAdmin('create',{employee})} onImportFinished={()=>void refresh()}/>
      case'team':return <TeamPage me={me} profiles={data.profiles} meetings={data.meetings} onOpen={setSelectedEmployee}/>
      case'surveys':return <SurveysPage me={me} profiles={data.profiles} templates={data.templates} runs={data.runs} assignments={data.assignments} answers={data.answers} schedules={data.schedules} onSend={(template,profile,audience)=>act(()=>api.sendSurvey(template,profile,me.id,data.profiles,audience),'Опрос отправлен')} onSendOneTime={(template,profile,audience)=>act(()=>api.sendOneTimeSurvey(template,profile,audience),'Разовый опрос отправлен')} onSubmit={(runId,values)=>act(()=>api.submitSurvey(runId,me.id,values),'Ответы отправлены')} onSaveTemplate={(template)=>act(()=>api.saveTemplate(template),'Шаблон обновлён')} onCreateTemplate={(template)=>act(()=>api.createTemplate(template),'Шаблон создан')} onDeleteTemplate={(id)=>act(()=>api.deleteTemplate(id),'Шаблон удалён')} onCreateSchedule={(values)=>act(()=>api.createSurveySchedule(values),'Расписание сохранено')} onDeleteSchedule={(id)=>act(()=>api.deleteSurveySchedule(id),'Регулярность удалена')}/>
      case'chats':return <ChatsPage me={me} profiles={data.profiles} chatDirectory={data.chatDirectory} chats={data.chats} messages={data.messages} onCreate={(title,ids)=>act(async()=>{await api.createChat(title,me.id,ids)},'Чат создан')} onSend={(chatId,body)=>act(()=>api.sendMessage(chatId,me.id,body),'Сообщение отправлено')} onRead={(chatId)=>act(()=>api.markChatRead(chatId,me.id),'')} onLeave={(chat)=>act(()=>api.leaveChat(chat,me.id),'Вы вышли из чата')} onRemove={(chat,id)=>act(()=>api.removeChatParticipant(chat,id),'Участник удалён')}/>
      case'documents':return <DocumentsPage me={me} profiles={data.profiles} items={data.documents} onUpload={async(file,title,share)=>{await api.uploadDocument(me.id,file,title,share);await refresh();setToast('Документ добавлен');setTimeout(()=>setToast(''),3500)}} onUpdate={(item,title,share)=>act(()=>api.updateDocument(item,{title,...share}),'Доступ обновлён')} onHide={(item)=>act(()=>api.hideDocument(item.id,me.id),'Документ удалён у вас')} onDelete={(item)=>act(()=>api.deleteDocumentEverywhere(item),'Документ удалён у всех')} onOpen={api.openDocument}/>
      case'links':return <LinksPage me={me} profiles={data.profiles} items={data.links} onCreate={(values,share)=>act(()=>api.createLink(me.id,{...values,...share}),'Ссылка добавлена')} onUpdate={(item,values,share)=>act(()=>api.updateLink(item,{...values,...share}),'Ссылка обновлена')} onHide={(item)=>act(()=>api.hideLink(item.id,me.id),'Ссылка удалена у вас')} onDelete={(item)=>act(()=>api.deleteLinkEverywhere(item.id),'Ссылка удалена у всех')}/>
    }
  }
  return <div className="app-backdrop"><div className="app-shell">
    <aside className={`sidebar ${mobileMenuOpen?'mobile-open':''}`} aria-label="Основная навигация">
      <button type="button" className="brand" onClick={()=>{setView('home');setSelectedEmployee(null);setMobileMenuOpen(false)}} aria-label="Открыть главную страницу" title="Главная"><span><Sparkles/></span><div><b>КОРУС</b><small>Пространство развития</small></div></button>
      <button className="sidebar-menu" aria-label="Меню"><Menu/><span>Меню</span></button>
      <nav>{nav.filter((item)=>item.show).map((item)=><button key={item.id} data-view={item.id} className={view===item.id&&!selectedEmployee?'active':''} onClick={()=>{setView(item.id);setSelectedEmployee(null);setMobileMenuOpen(false)}} title={item.label}><item.icon/><span>{item.label}</span>{Boolean(item.count)&&<i>{item.count}</i>}</button>)}</nav>
      <button className="sidebar-logout" onClick={()=>{setMobileMenuOpen(false);void logout()}} title="Выйти из аккаунта" aria-label="Выйти из аккаунта"><LogOut/><span>Выйти</span></button>
    </aside>
    {mobileMenuOpen&&<button className="mobile-nav-backdrop" onClick={()=>setMobileMenuOpen(false)} aria-label="Закрыть меню"/>}
    <main className="workspace">
      <header className="topbar">
        <div className="topbar-start"><button className="mobile-menu-trigger" onClick={()=>setMobileMenuOpen(true)} aria-label="Открыть меню" aria-expanded={mobileMenuOpen}><Menu/></button><div className="breadcrumbs">КОРУС <span>/</span> {nav.find((item)=>item.id===view)?.label}</div></div>
        <div className="top-actions">
          <button className="icon-button theme-quick-toggle" title={theme==='light'?'Включить тёмную тему':'Включить светлую тему'} aria-label={theme==='light'?'Включить тёмную тему':'Включить светлую тему'} onClick={()=>setTheme(theme==='light'?'dark':'light')}>{theme==='light'?<Moon/>:<Sun/>}</button>
          <button className="notification-button" onClick={()=>setNotificationsOpen(true)} aria-label="Уведомления"><Bell/>{unread>0&&<b>{unread}</b>}</button>
          <button className="profile-trigger" onClick={()=>setProfileOpen(true)} aria-label="Открыть профиль" title="Мой профиль"><Avatar profile={me} size="sm"/><UserRound className="profile-trigger-icon"/><span>Мой профиль</span></button>
        </div>
      </header>
      <div className="page-content" ref={pageContentRef}>{error&&<div className="form-error">{error}</div>}<div key={selectedEmployee?`employee-${selectedEmployee.id}`:view} className="page-transition">{page()}</div></div>
    </main>
    {notificationsOpen&&<NotificationsPanel notifications={data.notifications} meetings={ownMeetings} profiles={data.profiles} meId={me.id} onClose={()=>setNotificationsOpen(false)} onRead={(id)=>act(()=>api.readNotification(id),'Прочитано')} onReadAll={()=>act(()=>api.markAllNotificationsRead(me.id),'Все прочитано')} onDelete={(id)=>act(()=>api.deleteNotification(id),'Уведомление удалено')}/>} {profileOpen&&<ProfileModal me={me} profiles={data.profiles} onSave={(url)=>act(()=>api.saveTelegram(me.id,url),'Telegram сохранён')} onClose={()=>setProfileOpen(false)}/>} {toast&&<div className="toast"><span className="toast-check">✓</span>{toast}</div>}
  </div></div>
}

function PageTitle({eyebrow,title,text}:{eyebrow:string;title:string;text:string}){return <div className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div></div>}
function HomePage({me,data,calendar,ipr}:{me:Profile;data:api.WorkspaceData;calendar:ReactNode;ipr:ReactNode}){const own=data.meetings.filter((meeting)=>meeting.participant_ids?.includes(me.id)||(meeting.employee_id===me.id&&meeting.meeting_type!=='deadline'));const next=own.filter((meeting)=>new Date(meeting.scheduled_for)>new Date()).sort((a,b)=>a.scheduled_for.localeCompare(b.scheduled_for))[0];const completed=data.tasks.filter((task)=>task.employee_id===me.id&&task.status==='approved'&&task.is_completed).length;const total=data.tasks.filter((task)=>task.employee_id===me.id&&task.status==='approved').length;const progress=total?Math.round(completed/total*100):100;const selfAssessment=next&&progress<100&&((new Date(next.scheduled_for).getTime()-Date.now())/86400000<=7);return <>{selfAssessment&&<section className="deadline-banner"><Bell/><div><strong>Не забудьте заполнить самооценку</strong><span>До встречи осталось меньше недели. Отметьте выполненные задачи в разделе «Мой ИПР».</span></div><Badge tone="red">Важно</Badge></section>}<div className="welcome"><div><span className="eyebrow">{new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}</span><h1>Добрый день, {me.full_name.trim().split(/\s+/)[0]}</h1><p>Главная страница показывает ближайшие события и прогресс без редактирования.</p></div></div><div className="home-summary-grid"><article className="summary-tile summary-event"><CalendarDays/><div><small>Ближайшее событие</small><strong>{next?new Date(next.scheduled_for).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}):'Расписание свободно'}</strong><span>{next?next.title:'Встреч пока нет'}</span></div></article><article className="summary-tile summary-ipr"><CheckCircle2/><div><small>Прогресс ИПР</small>{total?<><strong>{progress}%</strong><span>{completed} из {total} задач выполнено</span></>:<strong>ИПР пока не заполнен</strong>}</div></article></div>{calendar}{ipr}</>}
function EmployeeOverview({person,profiles,meetings,onChat}:{person:Profile;profiles:Profile[];meetings:Meeting[];onChat:()=>void}){const hr=profiles.find((profile)=>profile.id===person.hr_id);const manager=profiles.find((profile)=>profile.id===person.manager_id);return <section className="card employee-overview"><Avatar profile={person} size="lg"/><div><span className="eyebrow">Профиль сотрудника</span><h1>{person.full_name}</h1><p>{person.job_title} · {person.department}</p><div className="profile-facts"><span><small>Почта</small>{person.corporate_email||'—'}</span><span><small>Телефон</small>{person.phone||'—'}</span><span><small>Telegram</small>{person.telegram_url||'—'}</span><span><small>Направление</small>{person.direction||'—'}</span><span><small>HR</small>{hr?.full_name??'—'}</span><span><small>Руководитель</small>{manager?.full_name??'—'}</span></div><OnboardingStepper employee={person} meetings={meetings}/></div><button className="button primary" onClick={onChat}>Написать</button></section>}
function ProfileModal({me,profiles,onSave,onClose}:{me:Profile;profiles:Profile[];onSave:(url:string)=>Promise<void>;onClose:()=>void}){const[url,setUrl]=useState(me.telegram_url??'');const[busy,setBusy]=useState(false);const hr=profiles.find((profile)=>profile.id===me.hr_id);const manager=profiles.find((profile)=>profile.id===me.manager_id);const name=profileNameParts(me.full_name);const submit=async()=>{if(busy)return;setBusy(true);try{await onSave(url)}finally{setBusy(false)}};return <Modal title="Мой профиль" subtitle="Корпоративные данные редактирует HR" onClose={onClose} wide><div className="profile-modal"><div className="profile-identity"><Avatar profile={me} size="lg"/><div><h2>{me.full_name}</h2><p>{me.job_title}</p><Badge tone="purple">{me.is_head_hr?'Администратор':me.is_hr?'HR':profiles.some((p)=>p.manager_id===me.id)?'Руководитель':'Сотрудник'}</Badge></div></div><div className="profile-facts"><span><small>Имя</small>{name.firstName||'—'}</span><span><small>Фамилия</small>{name.lastName||'—'}</span><span><small>Отчество</small>{name.middleName||'—'}</span><span><small>Корпоративная почта</small>{me.corporate_email||'—'}</span><span><small>Телефон</small>{me.phone||'—'}</span><span><small>Департамент</small>{me.department||'—'}</span><span><small>Направление</small>{me.direction||'—'}</span><span><small>HR</small>{hr?.full_name??'—'}</span><span><small>Руководитель</small>{manager?.full_name??'—'}</span></div><form className="profile-telegram" onSubmit={(event)=>{event.preventDefault();void submit()}}><label>Telegram<input type="url" placeholder="https://t.me/username" value={url} onChange={(event)=>setUrl(event.target.value)} disabled={busy}/></label><button className="button primary" disabled={busy}>{busy?'Сохраняем…':'Сохранить'}</button></form></div></Modal>}
function RescheduleApprovals({me,data,act}:{me:Profile;data:api.WorkspaceData;act:(action:()=>Promise<void>,message?:string)=>Promise<void>}){const requests=data.reschedules.filter((request)=>request.status==='pending'&&data.meetings.some((meeting)=>meeting.id===request.meeting_id&&(meeting.organizer_id===me.id||data.profiles.find((profile)=>profile.id===meeting.employee_id)?.hr_id===me.id)));return requests.length?<section className="card approvals-card"><div className="section-head"><div><span className="eyebrow">Требует решения</span><h2>Запросы на перенос</h2></div><Badge tone="orange">{requests.length}</Badge></div>{requests.map((request)=>{const meeting=data.meetings.find((item)=>item.id===request.meeting_id)!;return <div className="approval-row" key={request.id}><CalendarDays/><div><strong>{meeting.title}</strong><span>{new Date(request.proposed_for).toLocaleString('ru-RU')}</span><small>{request.reason}</small></div><button className="button secondary small" onClick={()=>void act(()=>api.decideReschedule(request,'rejected',me.id),'Перенос отклонён')}>Отклонить</button><button className="button primary small" onClick={()=>void act(()=>api.decideReschedule(request,'approved',me.id),'Новая дата подтверждена')}>Подтвердить</button></div>})}</section>:null}
const meetingInviteLabel=(meeting:Meeting)=>{
  const parts=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(meeting.scheduled_for))
  const value=(type:Intl.DateTimeFormatPartTypes)=>parts.find((part)=>part.type===type)?.value??''
  return `${meeting.title} · ${value('day')}.${value('month')}.${value('year')} ${value('hour')}:${value('minute')}`
}
const meetingInviteEnd=(item:api.WorkspaceData['notifications'][number],meetings:Meeting[])=>{
  if(item.kind!=='meeting_invite')return null
  const matching=meetings.find((meeting)=>item.body===meetingInviteLabel(meeting))
  if(matching)return new Date(matching.scheduled_for).getTime()+matching.duration_minutes*60000
  const legacyDate=item.body.match(/(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/)
  if(!legacyDate)return Number.POSITIVE_INFINITY
  const[,day,month,year,hour,minute]=legacyDate
  return Date.UTC(Number(year),Number(month)-1,Number(day),Number(hour)-3,Number(minute))+60*60000
}
const canDeleteNotification=(item:api.WorkspaceData['notifications'][number],meetings:Meeting[])=>{
  if(!item.dismissible)return false
  const meetingEnd=meetingInviteEnd(item,meetings)
  return meetingEnd===null||Date.now()>=meetingEnd
}

function NotificationsPanel({notifications,meetings,profiles,meId,onClose,onRead,onReadAll,onDelete}:{notifications:api.WorkspaceData['notifications'];meetings:Meeting[];profiles:Profile[];meId:string;onClose:()=>void;onRead:(id:number)=>Promise<void>;onReadAll:()=>Promise<void>;onDelete:(id:number)=>Promise<void>}){
  const[detail,setDetail]=useState<{title:string;body:string;date:string;kind:'meeting'|'notification'}|null>(null)
  const reminderReadKey=`korus-read-meeting-reminders:${meId}`
  const[readReminderIds,setReadReminderIds]=useState<number[]>(()=>{try{const stored=JSON.parse(localStorage.getItem(reminderReadKey)??'[]');return Array.isArray(stored)?stored.filter((id):id is number=>Number.isInteger(id)):[]}catch{return[]}})
  const reminders=useMemo(()=>meetings.filter((meeting)=>{if(meeting.meeting_type==='deadline')return false;const days=(new Date(meeting.scheduled_for).getTime()-Date.now())/86400000;return days>=0&&days<=7}),[meetings])
  const markRemindersRead=(ids:number[])=>setReadReminderIds((current)=>{const next=[...new Set([...current,...ids])];localStorage.setItem(reminderReadKey,JSON.stringify(next));return next})
  const readAll=()=>{markRemindersRead(reminders.map((meeting)=>meeting.id));void onReadAll()}
  return <div className="drawer-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}><aside className="notification-drawer"><div className="drawer-head"><div><h2>Уведомления</h2><p>Нажмите на уведомление, чтобы прочитать подробнее</p></div><button className="icon-button" onClick={onClose}><X/></button></div><button className="button secondary small read-all" onClick={readAll}>Прочитать все</button><div className="notification-list">{reminders.map((meeting)=>{const date=new Date(meeting.scheduled_for).toLocaleString('ru-RU');const iprPrep=meeting.meeting_type==='probation_end'&&meeting.participant_roles?.[meId]==='manager';const title=iprPrep?'Подготовьте ИПР':'Встреча в течение недели';const body=iprPrep?`Нужно подготовить ИПР для сотрудника ${profiles.find((profile)=>profile.id===meeting.employee_id)?.full_name??''}`:meeting.title;const open=()=>{markRemindersRead([meeting.id]);setDetail({title,body,date,kind:'meeting'})};return <article className={`notification ${readReminderIds.includes(meeting.id)?'':'unread'}`} role="button" tabIndex={0} key={`meeting-${meeting.id}`} onClick={open} onKeyDown={(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open()}}}><span className="notification-icon">{iprPrep?<ClipboardList/>:<CalendarDays/>}</span><div><strong>{title}</strong><p>{body}</p><small>{date}</small></div></article>})}{notifications.map((item)=>{const open=()=>{setDetail({title:item.title,body:item.body,date:new Date(item.created_at).toLocaleString('ru-RU'),kind:'notification'});if(!item.is_read)void onRead(item.id)};return <article className={`notification ${!item.is_read?'unread':''}`} role="button" tabIndex={0} key={item.id} onClick={open} onKeyDown={(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open()}}}><span className="notification-icon"><Bell/></span><div><strong>{item.title}</strong><p>{item.body}</p><small>{new Date(item.created_at).toLocaleString('ru-RU')}</small></div>{canDeleteNotification(item,meetings)&&<button className="icon-button" aria-label="Удалить уведомление" onClick={(event)=>{event.stopPropagation();void onDelete(item.id)}}><X/></button>}</article>})}{!reminders.length&&!notifications.length&&<EmptyState icon={<Bell/>} title="Пока тихо" text="Новые события появятся здесь."/>}</div></aside>{detail&&<Modal title={detail.title} subtitle={detail.kind==='meeting'?'Предстоящая встреча':'Уведомление'} onClose={()=>setDetail(null)} wide><div className="notification-detail"><span className="notification-detail-icon">{detail.kind==='meeting'?<CalendarDays/>:<Bell/>}</span><p>{detail.body}</p><time>{detail.date}</time><button className="button primary" onClick={()=>setDetail(null)}>Понятно</button></div></Modal>}</div>
}
