import { Search, UsersRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AccessScope, Profile } from '../types'
import { Avatar } from './UI'

export type ShareDraft={access_scope:AccessScope;department:string|null;recipient_ids:string[];team_employee_id?:string}

export function AccessEditor({profiles,value,onChange}:{profiles:Profile[];value:ShareDraft;onChange:(value:ShareDraft)=>void}){
  const[query,setQuery]=useState('')
  const departments=[...new Set(profiles.map((p)=>p.department).filter(Boolean))].sort()
  const results=useMemo(()=>profiles.filter((p)=>p.is_active&&p.full_name.toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU'))).slice(0,8),[profiles,query])
  const selectTeam=(employeeId:string)=>{const employee=profiles.find((p)=>p.id===employeeId);onChange({...value,team_employee_id:employeeId,recipient_ids:[...new Set([employeeId,employee?.hr_id,employee?.manager_id].filter(Boolean) as string[])]})}
  return <div className="access-editor"><label>Кому доступно<select value={value.access_scope} onChange={(e)=>onChange({...value,access_scope:e.target.value as AccessScope,recipient_ids:[],department:null,team_employee_id:''})}><option value="private">Только мне</option><option value="employee_team">Сотруднику, его HR и руководителю</option><option value="people">Конкретным сотрудникам</option><option value="department">Департаменту</option><option value="office">Всему офису</option></select></label>
    {value.access_scope==='employee_team'&&<label>Сотрудник<select value={value.team_employee_id??''} onChange={(e)=>selectTeam(e.target.value)} required><option value="">Выберите сотрудника</option>{profiles.filter((p)=>!p.is_hr).map((p)=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>}
    {value.access_scope==='department'&&<label>Департамент<select value={value.department??''} onChange={(e)=>onChange({...value,department:e.target.value})} required><option value="">Выберите департамент</option>{departments.map((department)=><option key={department}>{department}</option>)}</select></label>}
    {value.access_scope==='people'&&<div className="person-picker"><label>Поиск по ФИО<div className="search-box compact"><Search/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Имя, фамилия или отчество"/></div></label><div className="person-picker-list">{results.map((person)=>{const selected=value.recipient_ids.includes(person.id);return <button type="button" className={selected?'selected':''} key={person.id} onClick={()=>onChange({...value,recipient_ids:selected?value.recipient_ids.filter((id)=>id!==person.id):[...value.recipient_ids,person.id]})}><Avatar profile={person} size="sm"/><span><strong>{person.full_name}</strong><small>{person.job_title}</small></span><i>{selected?'✓':'+'}</i></button>})}</div>{value.recipient_ids.length>0&&<small className="selection-summary"><UsersRound/>Выбрано: {value.recipient_ids.length}</small>}</div>}
  </div>
}
