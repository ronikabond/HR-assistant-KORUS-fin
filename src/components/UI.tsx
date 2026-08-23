import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { Profile } from '../types'

const initials = (name:string) => name.split(/\s+/).slice(0,2).map((part)=>part[0]).join('').toUpperCase()
export function Avatar({profile,size='md'}:{profile:Profile;size?:'sm'|'md'|'lg'}) { return <span className={`avatar avatar-${size}`}>{initials(profile.full_name)}</span> }
export function Badge({children,tone='gray'}:{children:ReactNode;tone?:'gray'|'purple'|'green'|'red'|'orange'|'blue'}) { return <span className={`badge badge-${tone}`}>{children}</span> }
export function Modal({title,subtitle,onClose,children,wide=false,className=''}:{title:string;subtitle?:string;onClose:()=>void;children:ReactNode;wide?:boolean;className?:string}) {
  return createPortal(<div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}>
    <section className={`modal-card ${wide?'modal-wide':''} ${className}`.trim()} role="dialog" aria-modal="true">
      <button className="icon-button modal-close" onClick={onClose} aria-label="Закрыть"><X/></button>
      <div className="modal-heading"><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{children}
    </section>
  </div>,document.body)
}
export function EmptyState({icon, title, text, action}:{icon:ReactNode;title:string;text:string;action?:ReactNode}) { return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{action}</div> }
export function PersonLine({profile,meta,onClick}:{profile:Profile;meta?:string;onClick?:()=>void}) {
  const content = <><Avatar profile={profile}/><div><strong>{profile.full_name}</strong><span>{meta??profile.job_title}</span></div></>
  return onClick
    ? <button type="button" className="person-line person-line-clickable" onClick={onClick}>{content}</button>
    : <div className="person-line">{content}</div>
}
