import { LogOut, MessageCircle, Plus, Send, UserMinus, UsersRound } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { isSameDay, format } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { Chat, ChatMessage, EmployeeDirectoryEntry, Profile } from '../types'
import { Avatar, EmptyState, Modal } from '../components/UI'
import { ProfilePicker } from '../components/ProfilePicker'

type ChatPerson = { id:string; full_name:string }

const normalizeName=(value:string)=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU')

const chatPeople=(chat:Chat,profiles:Profile[]):ChatPerson[]=>
  chat.participants?.length
    ? chat.participants
    : (chat.participant_ids??[])
      .map((id)=>profiles.find((profile)=>profile.id===id))
      .filter((profile):profile is Profile=>Boolean(profile))

const otherPeople=(chat:Chat,me:Profile,profiles:Profile[])=>
  chatPeople(chat,profiles).filter((person)=>person.id!==me.id)

const chatTitle=(chat:Chat,me:Profile,profiles:Profile[])=>{
  const people=chatPeople(chat,profiles)
  const stored=chat.title.trim()
  const storedIsParticipantName=people.some((person)=>normalizeName(person.full_name)===normalizeName(stored))
  if(stored&&(chat.is_group||!storedIsParticipantName))return stored
  return otherPeople(chat,me,profiles).map((person)=>person.full_name).join(', ')||stored||'Чат'
}

const participantCountLabel=(count:number)=>{
  const mod100=count%100
  const mod10=count%10
  const word=mod100>=11&&mod100<=14?'участников':mod10===1?'участник':mod10>=2&&mod10<=4?'участника':'участников'
  return `${count} ${word}`
}

function dayLabel(date: Date): string {
  const now = new Date()
  if (isSameDay(date, now)) return 'Сегодня'
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  if (isSameDay(date, yesterday)) return 'Вчера'
  return format(date, date.getFullYear() === now.getFullYear() ? 'd MMMM' : 'd MMMM yyyy', { locale: ru })
}

export function ChatsPage({me,profiles,chatDirectory,chats,messages,onCreate,onSend,onRead,onLeave,onRemove}:{me:Profile;profiles:Profile[];chatDirectory:EmployeeDirectoryEntry[];chats:Chat[];messages:ChatMessage[];onCreate:(title:string,ids:string[])=>Promise<void>;onSend:(chatId:number,body:string)=>Promise<void>;onRead:(chatId:number)=>Promise<void>;onLeave:(chat:Chat)=>Promise<void>;onRemove:(chat:Chat,id:string)=>Promise<void>}){
  const[selectedId,setSelectedId]=useState(chats[0]?.id??null)
  const[creating,setCreating]=useState(false)
  const[body,setBody]=useState('')
  const[sending,setSending]=useState(false)
  const selected=chats.find((chat)=>chat.id===selectedId)??chats[0]
  const rows=useMemo(()=>selected?messages.filter((message)=>message.chat_id===selected.id):[],[messages,selected])
  const messagesEndRef=useRef<HTMLDivElement>(null)

  useEffect(()=>{messagesEndRef.current?.scrollIntoView({block:'end'})},[rows,selected?.id])
  useEffect(()=>{if(selected)void onRead(selected.id)},[selected?.id])

  const unread=(chat:Chat)=>messages.filter((message)=>
    message.chat_id===chat.id&&
    message.author_id!==me.id&&
    (!chat.last_read_at?.[me.id]||message.created_at>chat.last_read_at[me.id]!)
  ).length
  const choose=(chat:Chat)=>setSelectedId(chat.id)

  return <>
    <div className="page-title compact">
      <div><span className="eyebrow">Командное общение</span><h1>Чаты</h1></div>
      <button className="button primary" onClick={()=>setCreating(true)}><Plus/>Новый чат</button>
    </div>
    <section className="card chats-page">
      <aside className="chat-sidebar">
        <h3>Сообщения</h3>
        {chats.map((chat)=>{
          const count=chatPeople(chat,profiles).length
          return <button className={selected?.id===chat.id?'active':''} key={chat.id} onClick={()=>choose(chat)}>
            <span className="chat-avatar"><MessageCircle/></span>
            <span><strong>{chatTitle(chat,me,profiles)}</strong><small>{participantCountLabel(count)}</small></span>
            {unread(chat)>0&&<b>{unread(chat)}</b>}
          </button>
        })}
      </aside>
      <div className="chat-conversation">
        {selected?<>
          <header>
            <div>
              <strong>{chatTitle(selected,me,profiles)}</strong>
              <small>{otherPeople(selected,me,profiles).map((person)=>person.full_name).join(', ')}</small>
            </div>
            <button className="icon-button danger" title="Выйти из чата" onClick={()=>void onLeave(selected)}><LogOut/></button>
          </header>
          <div className="messages">
            {rows.map((message,i)=>{
              const author=chatPeople(selected,profiles).find((person)=>person.id===message.author_id)
              const date=new Date(message.created_at)
              const showDivider=i===0||!isSameDay(new Date(rows[i-1].created_at),date)
              return <Fragment key={message.id}>
                {showDivider&&<div className="chat-date-divider"><span>{dayLabel(date)}</span></div>}
                <article className={`message ${message.author_id===me.id?'mine':''}`}>
                  <small>{message.author_id===me.id?'Вы':author?.full_name??'Сотрудник'}</small>
                  <p>{message.body}</p>
                  <time>{date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time>
                </article>
              </Fragment>
            })}
            {!rows.length&&<EmptyState icon={<MessageCircle/>} title="Начните разговор" text="Первое сообщение появится здесь."/>}
            <div ref={messagesEndRef}/>
          </div>
          <form className="chat-compose" onSubmit={(event)=>{
            event.preventDefault()
            if(!body.trim()||sending)return
            setSending(true)
            void onSend(selected.id,body.trim()).then(()=>setBody('')).finally(()=>setSending(false))
          }}>
            <input value={body} onChange={(event)=>setBody(event.target.value)} placeholder="Напишите сообщение…" disabled={sending}/>
            <button aria-label="Отправить" disabled={sending||!body.trim()}><Send/></button>
          </form>
          {selected.created_by===me.id&&<div className="chat-members">
            {chatPeople(selected,profiles).filter((person)=>person.id!==me.id).map((person)=>
              <button key={person.id} onClick={()=>void onRemove(selected,person.id)} title="Удалить из чата">
                <Avatar profile={person} size="sm"/><span>{person.full_name}</span><UserMinus/>
              </button>
            )}
          </div>}
        </>:<EmptyState icon={<UsersRound/>} title="Чатов пока нет" text="Создайте личный или групповой чат с коллегами."/>}
      </div>
    </section>
    {creating&&<CreateChat
      profiles={chatDirectory.filter((profile)=>profile.id!==me.id)}
      onClose={()=>setCreating(false)}
      onCreate={async(title,ids)=>{await onCreate(title,ids);setCreating(false)}}
    />}
  </>
}

function CreateChat({profiles,onClose,onCreate}:{profiles:EmployeeDirectoryEntry[];onClose:()=>void;onCreate:(title:string,ids:string[])=>Promise<void>}){
  const[title,setTitle]=useState('')
  const[selected,setSelected]=useState<string[]>([])
  const[creating,setCreating]=useState(false)
  const submit=async()=>{
    if(!selected.length||creating)return
    setCreating(true)
    try{await onCreate(title||profiles.filter((profile)=>selected.includes(profile.id)).map((profile)=>profile.full_name).join(', '),selected)}finally{setCreating(false)}
  }
  return <Modal className="chat-create-modal" title="Новый чат" subtitle="Можно выбрать одного или нескольких сотрудников" onClose={onClose} wide>
    <form className="form-stack" onSubmit={(event)=>{
      event.preventDefault()
      void submit()
    }}>
      <label>Название<input value={title} onChange={(event)=>setTitle(event.target.value)} placeholder="Например, Команда проекта" disabled={creating}/></label>
      <fieldset disabled={creating}><legend>Участники</legend><ProfilePicker profiles={profiles} selectedIds={selected} onChange={setSelected} multiple/></fieldset>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={creating}>Отмена</button>
        <button className="button primary" disabled={!selected.length||creating}>{creating?'Создаём…':'Создать чат'}</button>
      </div>
    </form>
  </Modal>
}
