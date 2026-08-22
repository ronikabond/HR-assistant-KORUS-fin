import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react'

type DateTimeFieldProps={
  value:string
  onChange:(value:string)=>void
  type?:'date'|'datetime-local'
  required?:boolean
  ariaLabel?:string
}

const pad=(value:number)=>String(value).padStart(2,'0')
const parseLocal=(value:string)=>{
  const[datePart,timePart='00:00']=value.split('T')
  const[year,month,day]=datePart.split('-').map(Number)
  const[hours,minutes]=timePart.split(':').map(Number)
  if(!year||!month||!day)return null
  const parsed=new Date(year,month-1,day,hours||0,minutes||0)
  return Number.isNaN(parsed.getTime())?null:parsed
}
const serializeLocal=(date:Date,type:DateTimeFieldProps['type'])=>{
  const day=`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
  return type==='date'?day:`${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const sameDay=(a:Date,b:Date)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()
const monthTitle=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'})
const dateTitle=new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'long',year:'numeric'})

export function DateTimeField({value,onChange,type='date',required=false,ariaLabel='Выберите дату'}:DateTimeFieldProps){
  const[open,setOpen]=useState(false)
  const[visibleMonth,setVisibleMonth]=useState(()=>{const date=parseLocal(value)??new Date();return new Date(date.getFullYear(),date.getMonth(),1)})
  const[position,setPosition]=useState({top:0,left:0,width:380,maxHeight:560})
  const rootRef=useRef<HTMLDivElement>(null)
  const popupRef=useRef<HTMLDivElement>(null)
  const selected=parseLocal(value)
  const today=new Date()

  const days=useMemo(()=>{
    const first=new Date(visibleMonth.getFullYear(),visibleMonth.getMonth(),1)
    const mondayOffset=(first.getDay()+6)%7
    const start=new Date(first)
    start.setDate(first.getDate()-mondayOffset)
    return Array.from({length:42},(_,index)=>{const day=new Date(start);day.setDate(start.getDate()+index);return day})
  },[visibleMonth])

  const updatePosition=()=>{
    const rect=rootRef.current?.getBoundingClientRect()
    if(!rect)return
    const width=Math.min(380,window.innerWidth-24)
    const left=Math.max(12,Math.min(rect.left,window.innerWidth-width-12))
    const estimatedHeight=470
    const below=window.innerHeight-rect.bottom
    const placeBelow=below>=Math.min(estimatedHeight,window.innerHeight-24)||below>=rect.top
    const maxHeight=Math.max(250,(placeBelow?below:rect.top)-20)
    const top=placeBelow?rect.bottom+8:Math.max(12,rect.top-Math.min(estimatedHeight,maxHeight)-8)
    setPosition({top,left,width,maxHeight})
  }

  useEffect(()=>{
    if(!open)return
    const active=parseLocal(value)??new Date()
    setVisibleMonth(new Date(active.getFullYear(),active.getMonth(),1))
    updatePosition()
    const close=(event:PointerEvent)=>{
      const target=event.target as Node
      if(!rootRef.current?.contains(target)&&!popupRef.current?.contains(target))setOpen(false)
    }
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)}
    window.addEventListener('resize',updatePosition)
    window.addEventListener('scroll',updatePosition,true)
    document.addEventListener('pointerdown',close)
    document.addEventListener('keydown',escape)
    return()=>{
      window.removeEventListener('resize',updatePosition)
      window.removeEventListener('scroll',updatePosition,true)
      document.removeEventListener('pointerdown',close)
      document.removeEventListener('keydown',escape)
    }
  },[open,value])

  const chooseDay=(day:Date)=>{
    const next=new Date(day)
    next.setHours(selected?.getHours()??9,selected?.getMinutes()??0,0,0)
    onChange(serializeLocal(next,type))
    if(type==='date')setOpen(false)
  }
  const setTime=(part:'hours'|'minutes',raw:string)=>{
    const next=selected??new Date()
    const copy=new Date(next)
    const number=Number(raw)
    if(part==='hours')copy.setHours(Math.max(0,Math.min(23,number||0)))
    else copy.setMinutes(Math.max(0,Math.min(59,number||0)))
    onChange(serializeLocal(copy,type))
  }
  const chooseToday=()=>{
    const next=new Date()
    if(type==='datetime-local')next.setSeconds(0,0)
    onChange(serializeLocal(next,type))
    setVisibleMonth(new Date(next.getFullYear(),next.getMonth(),1))
    if(type==='date')setOpen(false)
  }

  const popup=open&&createPortal(<div ref={popupRef} className="date-picker-popover" style={{top:position.top,left:position.left,width:position.width}} role="dialog" aria-label={ariaLabel}>
    <div className="date-picker-head">
      <button type="button" onClick={()=>setVisibleMonth(new Date(visibleMonth.getFullYear(),visibleMonth.getMonth()-1,1))} aria-label="Предыдущий месяц"><ChevronLeft/></button>
      <strong>{monthTitle.format(visibleMonth)}</strong>
      <button type="button" onClick={()=>setVisibleMonth(new Date(visibleMonth.getFullYear(),visibleMonth.getMonth()+1,1))} aria-label="Следующий месяц"><ChevronRight/></button>
    </div>
    <div className="date-picker-weekdays">{['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((day)=><span key={day}>{day}</span>)}</div>
    <div className="date-picker-days">{days.map((day)=>{
      const isSelected=Boolean(selected&&sameDay(day,selected))
      return <button type="button" key={day.toISOString()} className={`${day.getMonth()!==visibleMonth.getMonth()?'outside ':''}${sameDay(day,today)?'today ':''}${isSelected?'selected':''}`.trim()} aria-pressed={isSelected} onClick={()=>chooseDay(day)}>{day.getDate()}</button>
    })}</div>
    {type==='datetime-local'&&<div className="date-picker-time"><Clock3/><span>Время</span><label><span className="sr-only">Часы</span><input type="number" min="0" max="23" value={pad(selected?.getHours()??9)} onChange={(event)=>setTime('hours',event.target.value)}/></label><b>:</b><label><span className="sr-only">Минуты</span><input type="number" min="0" max="59" step="5" value={pad(selected?.getMinutes()??0)} onChange={(event)=>setTime('minutes',event.target.value)}/></label></div>}
    <div className="date-picker-actions">{!required&&<button type="button" onClick={()=>{onChange('');setOpen(false)}}>Очистить</button>}<button type="button" onClick={chooseToday}>Сегодня</button>{type==='datetime-local'&&<button type="button" className="date-picker-done" onClick={()=>setOpen(false)}>Готово</button>}</div>
  </div>,document.body)

  return <div ref={rootRef} className={`date-time-field${open?' is-open':''}`}>
    <button type="button" className="date-time-trigger" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} aria-required={required} onClick={()=>setOpen((current)=>!current)}>
      <span>{selected?dateTitle.format(selected):'Выберите дату'}{selected&&type==='datetime-local'&&<small>{pad(selected.getHours())}:{pad(selected.getMinutes())}</small>}</span>
      {type==='datetime-local'?<Clock3/>:<CalendarDays/>}
    </button>
    {popup}
  </div>
}
