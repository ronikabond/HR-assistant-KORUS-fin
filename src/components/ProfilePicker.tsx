import { Check, Plus, Search, UsersRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { EmployeeDirectoryEntry } from '../types'
import { Avatar } from './UI'

export function ProfilePicker({profiles,selectedIds,onChange,multiple=false,emptyText='Сотрудники не найдены'}:{profiles:EmployeeDirectoryEntry[];selectedIds:string[];onChange:(ids:string[])=>void;multiple?:boolean;emptyText?:string}){
  const[query,setQuery]=useState('')
  const normalized=query.trim().toLocaleLowerCase('ru-RU')
  const results=useMemo(()=>profiles.filter((profile)=>profile.is_active!==false).filter((profile)=>`${profile.full_name} ${profile.job_title} ${profile.department??''}`.toLocaleLowerCase('ru-RU').includes(normalized)),[profiles,normalized])
  const choose=(id:string)=>onChange(multiple?(selectedIds.includes(id)?selectedIds.filter((item)=>item!==id):[...selectedIds,id]):[id])
  return <div className="profile-picker"><div className="search-box compact"><Search/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Имя, фамилия или отчество" aria-label="Поиск сотрудника по ФИО"/></div><div className="person-picker-list">{results.map((person)=>{const selected=selectedIds.includes(person.id);return <button type="button" className={selected?'selected':''} aria-pressed={selected} key={person.id} onClick={()=>choose(person.id)}><Avatar profile={person} size="sm"/><span><strong>{person.full_name}</strong><small>{person.job_title||person.department}</small></span><span className="profile-selection-indicator" aria-hidden="true"><Plus className="profile-selection-plus"/><Check className="profile-selection-check"/></span></button>})}</div>{!results.length&&<small className="picker-empty">{emptyText}</small>}{multiple&&<small className={`selection-summary ${selectedIds.length?'':'is-empty'}`} aria-live="polite"><UsersRound/>Выбрано: {selectedIds.length}</small>}</div>
}
