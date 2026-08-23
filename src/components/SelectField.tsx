import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export type SelectOption={value:string;label:string}

export function SelectField({value,options,onChange,disabled=false,required=false,ariaLabel='Выберите значение'}:{value:string;options:readonly SelectOption[];onChange:(value:string)=>void;disabled?:boolean;required?:boolean;ariaLabel?:string}){
  const[open,setOpen]=useState(false)
  const rootRef=useRef<HTMLDivElement>(null)
  const menuRef=useRef<HTMLDivElement>(null)
  const listId=useId()
  const selected=options.find((option)=>option.value===value)??options[0]

  useEffect(()=>{
    const close=(event:PointerEvent)=>{if(!rootRef.current?.contains(event.target as Node))setOpen(false)}
    document.addEventListener('pointerdown',close)
    return()=>document.removeEventListener('pointerdown',close)
  },[])
  useEffect(()=>{if(disabled)setOpen(false)},[disabled])
  useEffect(()=>{
    if(!open)return
    const frame=requestAnimationFrame(()=>menuRef.current?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'}))
    return()=>cancelAnimationFrame(frame)
  },[open,options.length])

  return <div ref={rootRef} className={`custom-select${open?' is-open':''}${disabled?' is-disabled':''}`}>
    <select className="custom-select-native" value={value} required={required} tabIndex={-1} aria-hidden="true" onInvalid={(event)=>{event.preventDefault();setOpen(true)}} onChange={(event)=>onChange(event.target.value)}>{options.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</select>
    <button type="button" className="custom-select-trigger" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} onClick={()=>setOpen((current)=>!current)} onKeyDown={(event)=>{if(event.key==='Escape')setOpen(false);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true)}}}>
      <span>{selected?.label??'Выберите значение'}</span><ChevronDown/>
    </button>
    <div ref={menuRef} id={listId} className="custom-select-menu" role="listbox" aria-label={ariaLabel}>
      {options.map((option)=><button type="button" role="option" aria-selected={option.value===value} className={option.value===value?'selected':''} key={option.value} onClick={()=>{onChange(option.value);setOpen(false)}}><span>{option.label}</span><Check/></button>)}
    </div>
  </div>
}
