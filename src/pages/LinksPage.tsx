import { BookmarkPlus, Building2, ExternalLink, FileStack, Globe2, Link2, Pencil, Plus, Search, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { useMemo, useState, type ComponentType } from 'react'
import type { Profile, ResourceLink } from '../types'
import { AccessEditor, type ShareDraft } from '../components/AccessEditor'
import { EmptyState, Modal } from '../components/UI'

const categories = ['Общее', 'Шаблоны и примеры', 'Пресейл', 'Консалтинг', 'Добавленные'] as const
type LinkCategory = typeof categories[number]

type CatalogLink = {
  key: string
  title: string
  url: string
  description: string
  category: LinkCategory
  resource?: ResourceLink
}

const curatedLinks: CatalogLink[] = [
  {
    key: 'org-structure',
    category: 'Общее',
    title: 'Организационная структура департамента CRM',
    description: 'Схема команд, ролей и зон ответственности департамента в ЦУП.',
    url: 'https://mcc.korusconsulting.ru/departments/crm/Lists/MgmtDocs/%D0%9E%D1%80%D0%B3%D0%B0%D0%BD%D0%B8%D0%B7%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%BD%D0%B0%D1%8F%20%D1%81%D1%82%D1%80%D1%83%D0%BA%D1%82%D1%83%D1%80%D0%B0%20%D0%B4%D0%B5%D0%BF%D0%B0%D1%80%D1%82%D0%B0/%D0%9E%D1%80%D0%B3%D1%81%D1%82%D1%80%D1%83%D0%BA%D1%82%D1%83%D1%80%D0%B0%202026.pptx?d=w33cd8403af254d20a735aa1dc8f6ee28',
  },
  {
    key: 'department-strategy',
    category: 'Общее',
    title: 'Стратегия департамента 2026–2029',
    description: 'Стратегические ориентиры и приоритеты развития департамента CRM.',
    url: 'https://mcc.korusconsulting.ru/departments/crm/Lists/MgmtDocs/%D0%A1%D1%82%D1%80%D0%B0%D1%82%D0%B5%D0%B3%D0%B8%D1%8F%20%D0%B4%D0%B5%D0%BF%D0%B0%D1%80%D1%82%D0%B0%D0%BC%D0%B5%D0%BD%D1%82%D0%B0/%D0%A1%D1%82%D1%80%D0%B0%D1%82%D0%B5%D0%B3%D0%B8%D1%8F_%D0%BE%D1%82%2018.05.2026.pptx?d=wd6e6972f7bc54236978d19cd8cbcc91f',
  },
  {
    key: 'document-templates',
    category: 'Шаблоны и примеры',
    title: 'Все шаблоны и примеры документов',
    description: 'Единая библиотека шаблонов и примеров рабочих документов.',
    url: 'https://mcc.korusconsulting.ru/departments/crm/Lists/TemplateDocs/Forms/AllItems.aspx',
  },
  {
    key: 'preproject-examples',
    category: 'Шаблоны и примеры',
    title: 'Примеры предпроектного обследования',
    description: 'Подборка документов предпроектного обследования от коллег из ERP.',
    url: 'https://mcc.korusconsulting.ru/departments/crm/Lists/TemplateDocs/Forms/AllItems.aspx?RootFolder=%2Fdepartments%2Fcrm%2FLists%2FTemplateDocs%2F01%2E%20%D0%9F%D1%80%D0%B5%D0%B4%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D0%BD%D1%8B%D0%B5%20%D0%B4%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82%D1%8B%2F%D0%9F%D1%80%D0%B5%D0%B4%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D0%BD%D0%BE%D0%B5%20%D0%BE%D0%B1%D1%81%D0%BB%D0%B5%D0%B4%D0%BE%D0%B2%D0%B0%D0%BD%D0%B8%D0%B5%2F%D0%9F%D1%80%D0%B8%D0%BC%D0%B5%D1%80%D1%8B%20%D0%BE%D1%82%20ERP&FolderCTID=0x01200017FBAC0381C49B4C94E9078439BB8B44&View=%7BF13C7CF6%2D1DF7%2D457E%2DBAD4%2D73917E6CE52C%7D',
  },
  {
    key: 'presale-regulation',
    category: 'Пресейл',
    title: 'Регламент по привлечению к пресейлу',
    description: 'Порядок привлечения сотрудников департамента к продажам и пресейлу.',
    url: 'https://mcc.korusconsulting.ru/departments/crm/Lists/RegulationDocs/00.%20%D0%9F%D1%80%D0%B5%D1%81%D0%B5%D0%B9%D0%BB',
  },
  {
    key: 'project-estimation',
    category: 'Пресейл',
    title: 'Оценка проекта',
    description: 'Шаблоны и пример оценки проекта для подготовки предложения.',
    url: 'https://mcc.korusconsulting.ru/departments/crm/Lists/TemplateDocs/01.%20%D0%9F%D1%80%D0%B5%D0%B4%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D0%BD%D1%8B%D0%B5%20%D0%B4%D0%BE%D0%BA%D1%83%D0%BC%D0%B5%D0%BD%D1%82%D1%8B/%D0%9E%D1%86%D0%B5%D0%BD%D0%BA%D0%B0%20%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D0%B0',
  },
  {
    key: 'dynamics-setup',
    category: 'Консалтинг',
    title: 'Регламент по настройке Dynamics 365',
    description: 'Рабочий регламент настройки решений на базе Dynamics 365.',
    url: 'https://mcc.korusconsulting.ru/departments/crm/Lists/RegulationDocs/Forms/AllItems.aspx?RootFolder=%2Fdepartments%2Fcrm%2FLists%2FRegulationDocs%2F02%2E%20%D0%9A%D0%BE%D0%BD%D1%81%D0%B0%D0%BB%D1%82%D0%B8%D0%BD%D0%B3%2FDynamics%20CRM&FolderCTID=0x0120000169478BF95A5B4B9DE1758FC8E595D5&View=%7B0CCCB99B%2DCD86%2D42E7%2D87C4%2DBAB1024061D9%7D',
  },
  {
    key: 'consultant-competencies',
    category: 'Консалтинг',
    title: 'Матрица компетенций консультанта',
    description: 'Матрица компетенций консультантов по Microsoft Dynamics CRM.',
    url: 'https://mcc.korusconsulting.ru/departments/crm/Lists/RegulationDocs/02.%20%D0%9A%D0%BE%D0%BD%D1%81%D0%B0%D0%BB%D1%8C%D1%82%D0%B8%D0%BD%D0%B3/%D0%9C%D0%B0%D1%82%D1%80%D0%B8%D1%86%D0%B0%20%D0%BA%D0%BE%D0%BC%D0%BF%D0%B5%D1%82%D0%B5%D0%BD%D1%86%D0%B8%D0%B9%20%D0%9A%D0%BE%D0%BD%D1%81%D1%83%D0%BB%D1%8C%D1%82%D0%B0%D0%BD%D1%82%D0%B0%20(Dynamics%20CRM)_v2.xlsx?d=w16e89b0e61dc41a7978b395552d52830',
  },
]

const categoryIcons: Record<LinkCategory, ComponentType> = {
  'Общее': Building2,
  'Шаблоны и примеры': FileStack,
  'Пресейл': Sparkles,
  'Консалтинг': Settings2,
  'Добавленные': BookmarkPlus,
}

const categoryTones: Record<LinkCategory, string> = {
  'Общее': 'violet',
  'Шаблоны и примеры': 'blue',
  'Пресейл': 'orange',
  'Консалтинг': 'green',
  'Добавленные': 'rose',
}

function linkHost(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') }
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
  const availableCategories=useMemo(()=>categories.filter((name)=>catalog.some((item)=>item.category===name)),[catalog])
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
