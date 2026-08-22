import { BookmarkPlus, Building2, ExternalLink, FileStack, Globe2, Link2, Pencil, Plus, Search, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState, type ComponentType } from 'react'
import type { Profile, ResourceLink } from '../types'
import { AccessEditor, type ShareDraft } from '../components/AccessEditor'
import { EmptyState, Modal } from '../components/UI'
import { curatedLinks, linkCategories, type CuratedLink, type LinkCategory } from '../data/curatedLinks'

type CatalogLink = CuratedLink & {
  resource?: ResourceLink
}

const categoryIcons: Record<LinkCategory, ComponentType> = {
  'Общее': Building2,
  'Шаблоны и примеры': FileStack,
  'Пресейл': Sparkles,
  'Консалтинг': Settings2,
  'Разработка': Settings2,
  'Тех. поддержка': Settings2,
  'Управление проектами': FileStack,
  'Продажи': Sparkles,
  'Собственные решения': BookmarkPlus,
  'Маркетинг': Globe2,
  'Записи и презентации': FileStack,
  'Таймшиты': BookmarkPlus,
  'Вопросы и ответы': Globe2,
  'Ребрендинг': Sparkles,
  'База знаний': BookmarkPlus,
  'Добавленные': BookmarkPlus,
}

const categoryTones: Record<LinkCategory, string> = {
  'Общее': 'violet',
  'Шаблоны и примеры': 'blue',
  'Пресейл': 'orange',
  'Консалтинг': 'green',
  'Разработка': 'violet',
  'Тех. поддержка': 'blue',
  'Управление проектами': 'orange',
  'Продажи': 'green',
  'Собственные решения': 'rose',
  'Маркетинг': 'violet',
  'Записи и презентации': 'blue',
  'Таймшиты': 'orange',
  'Вопросы и ответы': 'green',
  'Ребрендинг': 'rose',
  'База знаний': 'violet',
  'Добавленные': 'rose',
}

function linkHost(url: string) {
  try { const parsed=new URL(url);return parsed.protocol==='file:'?'Внутренняя сеть · VPN':parsed.hostname.replace(/^www\./, '') }
  catch { return 'Корпоративный ресурс' }
}

export function LinksPage({me,profiles,items,onCreate,onUpdate,onHide,onDelete}:{me:Profile;profiles:Profile[];items:ResourceLink[];onCreate:(values:{title:string;url:string;description:string},share:ShareDraft)=>Promise<void>;onUpdate:(item:ResourceLink,values:{title:string;url:string;description:string},share:ShareDraft)=>Promise<void>;onHide:(item:ResourceLink)=>Promise<void>;onDelete:(item:ResourceLink)=>Promise<void>}) {
  const [editing,setEditing]=useState<ResourceLink|null|undefined>(undefined)
  const [deleting,setDeleting]=useState<ResourceLink|null>(null)
  const [query,setQuery]=useState('')
  const [category,setCategory]=useState<LinkCategory|'Все'>('Все')
  const canManage=(item:ResourceLink)=>item.owner_id===me.id||me.is_head_hr
  const catalog=useMemo<CatalogLink[]>(()=>[
    ...curatedLinks,
    ...items.map((item)=>({key:`resource-${item.id}`,title:item.title,url:item.url,description:item.description||item.url,category:'Добавленные' as const,resource:item})),
  ],[items])
  const availableCategories=useMemo(()=>linkCategories.filter((name)=>catalog.some((item)=>item.category===name)),[catalog])
  const visibleItems=useMemo(()=>{const normalized=query.trim().toLocaleLowerCase('ru-RU');return catalog.filter((item)=>(category==='Все'||item.category===category)&&(!normalized||`${item.title} ${item.description} ${item.category}`.toLocaleLowerCase('ru-RU').includes(normalized)))},[catalog,category,query])

  return <>
    <div className="page-title links-page-title"><div><span className="eyebrow">База знаний</span><h1>Полезные ссылки</h1><p>Проверенные сервисы, шаблоны и материалы для ежедневной работы.</p></div>{me.is_hr&&<button className="button primary" onClick={()=>setEditing(null)}><Plus/>Добавить ссылку</button>}</div>
    <section className="links-toolbar card">
      <label className="links-search"><Search/><input type="search" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Найти ресурс по названию или описанию…" aria-label="Поиск по полезным ссылкам"/>{query&&<button type="button" onClick={()=>setQuery('')} aria-label="Очистить поиск">×</button>}</label>
      <div className="link-category-filters" aria-label="Фильтр по категориям"><button className={category==='Все'?'active':''} onClick={()=>setCategory('Все')} aria-pressed={category==='Все'}>Все <span>{catalog.length}</span></button>{availableCategories.map((name)=><button key={name} className={category===name?'active':''} onClick={()=>setCategory(name)} aria-pressed={category===name}>{name}<span>{catalog.filter((item)=>item.category===name).length}</span></button>)}</div>
    </section>
    <div className="links-results-head"><span>{visibleItems.length} {visibleItems.length===1?'ресурс':visibleItems.length>=2&&visibleItems.length<=4?'ресурса':'ресурсов'}</span>{category!=='Все'&&<button onClick={()=>setCategory('Все')}>Сбросить фильтр</button>}</div>
    <section className="links-grid catalog-links-grid">
      {visibleItems.map((item)=>{const CategoryIcon=categoryIcons[item.category];const resource=item.resource;return <article className={`link-card catalog-link-card tone-${categoryTones[item.category]}`} key={item.key}>
        <header><span className="link-symbol"><CategoryIcon/></span><span className="link-category">{item.category}</span>{resource&&<div className="row-actions">{canManage(resource)&&<button className="icon-button" onClick={()=>setEditing(resource)} aria-label={`Изменить ${resource.title}`}><Pencil/></button>}<button className="icon-button danger" onClick={()=>setDeleting(resource)} aria-label={`Удалить ${resource.title}`}><Trash2/></button></div>}</header>
        <div className="link-card-copy"><h3>{item.title}</h3><p>{item.description}</p></div>
        <footer><span><Globe2/>{linkHost(item.url)}</span><a href={item.url} target="_blank" rel="noreferrer">Открыть <ExternalLink/></a></footer>
      </article>})}
      {!visibleItems.length&&<div className="card material-empty links-empty"><EmptyState icon={<Link2/>} title="Ничего не найдено" text="Попробуйте изменить запрос или выбрать другую категорию."/><button className="button secondary" onClick={()=>{setQuery('');setCategory('Все')}}>Сбросить фильтры</button></div>}
    </section>
    {editing!==undefined&&<LinkForm profiles={profiles} item={editing??undefined} onClose={()=>setEditing(undefined)} onSubmit={async(values,share)=>{if(editing)await onUpdate(editing,values,share);else await onCreate(values,share);setEditing(undefined)}}/>}
    {deleting&&<Modal title="Удалить ссылку?" subtitle={deleting.title} onClose={()=>setDeleting(null)}><div className="delete-choices"><button className="button secondary" onClick={()=>setDeleting(null)}>Отмена</button><button className="button secondary" onClick={()=>void onHide(deleting).then(()=>setDeleting(null))}>Только у себя</button>{canManage(deleting)&&<button className="button danger-button" onClick={()=>void onDelete(deleting).then(()=>setDeleting(null))}>У всех</button>}</div></Modal>}
  </>
}

function LinkForm({profiles,item,onClose,onSubmit}:{profiles:Profile[];item?:ResourceLink;onClose:()=>void;onSubmit:(values:{title:string;url:string;description:string},share:ShareDraft)=>Promise<void>}){const[values,setValues]=useState({title:item?.title??'',url:item?.url??'https://',description:item?.description??''});const[share,setShare]=useState<ShareDraft>({access_scope:item?.access_scope??'office',department:item?.department??null,recipient_ids:item?.recipient_ids??[]});return <Modal title={item?'Изменить ссылку':'Новая полезная ссылка'} onClose={onClose} wide><form className="form-stack" onSubmit={(e)=>{e.preventDefault();void onSubmit(values,share)}}><label>Название<input value={values.title} onChange={(e)=>setValues({...values,title:e.target.value})} required/></label><label>Адрес<input type="url" value={values.url} onChange={(e)=>setValues({...values,url:e.target.value})} required/></label><label>Описание<textarea value={values.description} onChange={(e)=>setValues({...values,description:e.target.value})}/></label><AccessEditor profiles={profiles} value={share} onChange={setShare}/><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Отмена</button><button className="button primary">Сохранить</button></div></form></Modal>}
