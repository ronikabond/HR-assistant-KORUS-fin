import { useState } from 'react'
import { BarChart3, CalendarClock, CheckCircle2, ClipboardList, Edit3, Eye, Plus, Save, Send, Trash2, UserRound, Users } from 'lucide-react'
import type { Profile, SurveyQuestion, SurveyRun, SurveySchedule, SurveyTemplate } from '../types'
import { Avatar, Badge, EmptyState, Modal, PersonLine } from '../components/UI'
import { ProfilePicker } from '../components/ProfilePicker'
import { SelectField } from '../components/SelectField'
import { DateTimeField } from '../components/DateTimeField'

type Assignment={run_id:number;respondent_id:string;completed_at:string|null}
type Answer={run_id:number;respondent_id:string;question_id:number;value:string}
type Audience='person'|'colleagues'|'all'
type SurveyDraft=Omit<SurveyTemplate,'id'>
type SurveyMode='create'|'templates'
type SurveyKind='self'|'colleagues'

type SurveysPageProps={
  me:Profile
  profiles:Profile[]
  templates:SurveyTemplate[]
  runs:SurveyRun[]
  assignments:Assignment[]
  answers:Answer[]
  schedules:SurveySchedule[]
  onSend:(template:SurveyTemplate,subject:Profile,audience:Audience)=>Promise<void>
  onSendOneTime:(template:SurveyDraft,subject:Profile,audience:Audience)=>Promise<void>
  onSubmit:(runId:number,values:Record<number,string>)=>Promise<void>
  onSaveTemplate:(template:SurveyTemplate)=>Promise<void>
  onCreateTemplate:(template:SurveyDraft)=>Promise<void>
  onDeleteTemplate:(id:number)=>Promise<void>
  onCreateSchedule:(values:Omit<SurveySchedule,'id'|'created_at'>)=>Promise<void>
  onDeleteSchedule:(id:number)=>Promise<void>
}

const audienceOptions=[{value:'person',label:'Сам сотрудник'},{value:'colleagues',label:'Коллеги и руководитель'},{value:'all',label:'Все сотрудники'}]
const frequencyOptions=[{value:'weekly',label:'Каждую неделю'},{value:'monthly',label:'Каждый месяц'},{value:'quarterly',label:'Каждый квартал'},{value:'semiannual',label:'Раз в полгода'},{value:'yearly',label:'Каждый год'}]
const answerTypeOptions=[{value:'text',label:'Текст'},{value:'scale',label:'Шкала 1–10'}]
const emptyDraft=(kind:SurveyKind):SurveyDraft=>({kind,title:'',description:'',questions:[{text:'',answer_type:'text',position:1}]})

export function SurveysPage({me,profiles,templates,runs,assignments,answers,schedules,onSend,onSendOneTime,onSubmit,onSaveTemplate,onCreateTemplate,onDeleteTemplate,onCreateSchedule,onDeleteSchedule}:SurveysPageProps){
  const[kind,setKind]=useState<SurveyKind>('self')
  const[mode,setMode]=useState<SurveyMode>('templates')
  const[builderVersion,setBuilderVersion]=useState(0)
  const[taking,setTaking]=useState<SurveyRun|null>(null)
  const[sending,setSending]=useState<SurveyTemplate|null>(null)
  const[oneTimeDraft,setOneTimeDraft]=useState<SurveyDraft|null>(null)
  const[templateDialog,setTemplateDialog]=useState<{template:SurveyTemplate;editing:boolean}|null>(null)
  const[results,setResults]=useState<SurveyRun|null>(null)
  const pending=runs.filter((run)=>assignments.some((assignment)=>assignment.run_id===run.id&&assignment.respondent_id===me.id&&!assignment.completed_at))
  const managed=runs.filter((run)=>{const subject=profiles.find((profile)=>profile.id===run.subject_id);return me.is_head_hr||subject?.hr_id===me.id||subject?.manager_id===me.id})
  const availableSubjects=profiles.filter((profile)=>me.is_head_hr||profile.hr_id===me.id||profile.id===me.id)
  const visibleTemplates=templates.filter((template)=>template.kind===kind)
  const templateFor=(run:SurveyRun)=>run.template??templates.find((template)=>template.id===run.template_id)
  const subjectFor=(run:SurveyRun)=>profiles.find((profile)=>profile.id===run.subject_id)

  return <>
    <div className="page-title surveys-page-title">
      <div><span className="eyebrow">Обратная связь</span><h1>Опросы</h1><p>Создавайте разовые опросы или используйте сохранённые шаблоны.</p></div>
    </div>

    {pending.length>0&&<section className="card pending-surveys"><div className="section-head"><div><h2>Нужно пройти</h2><p>Ваши ответы сохранятся после отправки.</p></div><Badge tone="orange">{pending.length}</Badge></div>{pending.map((run)=>{const template=templateFor(run);const subject=subjectFor(run);return <button className="survey-inbox-row" key={run.id} onClick={()=>setTaking(run)}><div className="survey-symbol"><ClipboardList/></div><div><strong>{template?.title}</strong><span>О сотруднике: {subject?.full_name??'Уволенный сотрудник'}</span></div><span className="button primary small">Пройти</span></button>})}</section>}

    {me.is_hr&&<>
      <div className="survey-kind-grid" aria-label="Виды опросов">
        <SurveyKindCard kind="self" selectedKind={kind} templateCount={templates.filter((template)=>template.kind==='self').length} onSelect={(nextMode)=>{setKind('self');setMode(nextMode)}}/>
        <SurveyKindCard kind="colleagues" selectedKind={kind} templateCount={templates.filter((template)=>template.kind==='colleagues').length} onSelect={(nextMode)=>{setKind('colleagues');setMode(nextMode)}}/>
      </div>

      <section className="survey-type-workspace" aria-label={`${kindLabel(kind)} · ${mode==='create'?'создание':'шаблоны'}`}>
        <div className="survey-type-workspace-head"><div><span className="eyebrow">{kindLabel(kind)}</span><h2>{mode==='create'?'Создать новый опрос':'Шаблоны опросов'}</h2><p>{kind==='self'?'Вопросы для самооценки и рефлексии сотрудника.':'Вопросы для обратной связи от коллег и руководителя.'}</p></div><Badge tone={kind==='self'?'blue':'purple'}>{mode==='create'?'Новый':`Шаблонов: ${visibleTemplates.length}`}</Badge></div>
        {mode==='create'?<NewSurveyBuilder key={`${kind}-${builderVersion}`} kind={kind} onSave={async(template)=>{await onCreateTemplate(template);setBuilderVersion((version)=>version+1);setMode('templates')}} onSend={setOneTimeDraft}/>:<TemplateLibrary kind={kind} templates={visibleTemplates} onView={(template)=>setTemplateDialog({template,editing:false})} onEdit={(template)=>setTemplateDialog({template,editing:true})} onSend={setSending} onDelete={onDeleteTemplate}/>}
      </section>

      {schedules.length>0&&<section className="card survey-schedules-card"><div className="section-head"><div><h2>Регулярные публикации</h2><p>Запланированные опросы отображаются в календаре HR.</p></div></div>{schedules.map((schedule)=><div className="schedule-row" key={schedule.id}><CalendarClock/><div><strong>{templates.find((template)=>template.id===schedule.template_id)?.title??'Опрос'}</strong><span>{frequencyLabel(schedule.frequency)} · с {new Date(schedule.starts_at).toLocaleDateString('ru-RU')}{schedule.ends_at?` до ${new Date(schedule.ends_at).toLocaleDateString('ru-RU')}`:''}</span></div><button className="icon-button danger" onClick={()=>void onDeleteSchedule(schedule.id)} aria-label="Удалить расписание"><Trash2/></button></div>)}</section>}

      <section className="card survey-history-card"><div className="section-head"><div><h2>История отправок</h2><p>HR и руководитель видят прогресс и детальные именные ответы.</p></div></div>{managed.length===0?<EmptyState icon={<BarChart3/>} title="Опросов пока нет" text="Создайте новый опрос или отправьте сохранённый шаблон."/>:<div className="survey-runs">{managed.map((run)=>{const assigned=assignments.filter((assignment)=>assignment.run_id===run.id);const done=assigned.filter((assignment)=>assignment.completed_at);const subject=subjectFor(run);return <button key={run.id} onClick={()=>setResults(run)}>{subject&&<Avatar profile={subject}/>}<div><strong>{subject?.full_name??'Уволенный сотрудник'}</strong><span>{templateFor(run)?.title}</span></div><div className="run-progress"><b>{done.length} из {assigned.length}</b><span><i style={{width:`${assigned.length?done.length/assigned.length*100:0}%`}}/></span></div></button>})}</div>}</section>
    </>}

    {!me.is_hr&&pending.length===0&&<section className="card"><EmptyState icon={<CheckCircle2/>} title="Все опросы пройдены" text="Новые опросы появятся здесь после отправки вашим HR."/></section>}

    {taking&&templateFor(taking)&&subjectFor(taking)&&<TakeSurvey run={taking} template={templateFor(taking)!} subject={subjectFor(taking)!} onClose={()=>setTaking(null)} onSubmit={async(values)=>{await onSubmit(taking.id,values);setTaking(null)}}/>}
    {sending&&<SendSurvey template={sending} profiles={availableSubjects} onClose={()=>setSending(null)} onSubmit={async(profile,audience,schedule)=>{if(schedule)await onCreateSchedule({template_id:sending.id,subject_id:profile.id,created_by:me.id,audience,...schedule,is_active:true});else await onSend(sending,profile,audience);setSending(null)}}/>}
    {oneTimeDraft&&<SendSurvey template={oneTimeDraft} profiles={availableSubjects} allowSchedule={false} onClose={()=>setOneTimeDraft(null)} onSubmit={async(profile,audience)=>{await onSendOneTime(oneTimeDraft,profile,audience);setOneTimeDraft(null);setBuilderVersion((version)=>version+1)}}/>}
    {templateDialog&&<EditTemplate key={`${templateDialog.template.id}-${templateDialog.editing?'edit':'view'}`} template={templateDialog.template} initialEditing={templateDialog.editing} onClose={()=>setTemplateDialog(null)} onSubmit={async(template)=>{await onSaveTemplate(template);setTemplateDialog(null)}}/>}
    {results&&templateFor(results)&&subjectFor(results)&&<SurveyResults run={results} template={templateFor(results)!} subject={subjectFor(results)!} profiles={profiles} assignments={assignments} answers={answers} onClose={()=>setResults(null)}/>}
  </>
}

const kindLabel=(kind:SurveyKind)=>kind==='self'?'Опрос сотрудника':'Опрос коллег'

function SurveyKindCard({kind,selectedKind,templateCount,onSelect}:{kind:SurveyKind;selectedKind:SurveyKind;templateCount:number;onSelect:(mode:SurveyMode)=>void}){
  const isSelf=kind==='self'
  return <article className={`survey-kind-card ${selectedKind===kind?'active':''}`}>
    <div className={`survey-kind-icon ${kind}`}>{isSelf?<UserRound/>:<Users/>}</div>
    <Badge tone={isSelf?'blue':'purple'}>{isSelf?'Личный':'Командный'}</Badge>
    <h2>{kindLabel(kind)}</h2>
    <p>{isSelf?'Самооценка сотрудника: результаты, развитие и необходимая поддержка.':'Обратная связь о сотруднике от коллег и руководителя.'}</p>
    <div className="survey-kind-actions">
      <button type="button" className="button secondary" onClick={()=>onSelect('create')}><Plus/>Создать новый</button>
      <button type="button" className="button primary" onClick={()=>onSelect('templates')}><ClipboardList/>Посмотреть шаблоны <span>{templateCount}</span></button>
    </div>
  </article>
}

function TemplateLibrary({kind,templates,onView,onEdit,onSend,onDelete}:{kind:SurveyKind;templates:SurveyTemplate[];onView:(template:SurveyTemplate)=>void;onEdit:(template:SurveyTemplate)=>void;onSend:(template:SurveyTemplate)=>void;onDelete:(id:number)=>Promise<void>}){
  if(!templates.length)return <section className="card survey-library-empty"><EmptyState icon={<ClipboardList/>} title={`Шаблонов «${kindLabel(kind)}» пока нет`} text="Создайте опрос и сохраните его в шаблоны — он появится здесь."/></section>
  return <section aria-label={`Шаблоны · ${kindLabel(kind)}`}><div className="template-grid">{templates.map((template)=><article className="template-card" key={template.id}><div className={`template-icon ${template.kind}`}><ClipboardList/></div><Badge tone={template.kind==='self'?'blue':'purple'}>{kindLabel(kind)}</Badge><h3>{template.title}</h3><p>{template.description}</p><span>{template.questions.length} вопросов</span><div className="template-actions survey-template-actions"><button className="button secondary small" onClick={()=>onView(template)}><Eye/>Посмотреть</button><button className="button secondary small" onClick={()=>onEdit(template)}><Edit3/>Редактировать</button><button className="button primary small" onClick={()=>onSend(template)}><Send/>Отправить</button><button className="button danger-button small" onClick={()=>void onDelete(template.id)} aria-label={`Удалить шаблон ${template.title}`}><Trash2/>Удалить</button></div></article>)}</div></section>
}

function NewSurveyBuilder({kind,onSave,onSend}:{kind:SurveyKind;onSave:(template:SurveyDraft)=>Promise<void>;onSend:(template:SurveyDraft)=>void}){
  const[draft,setDraft]=useState<SurveyDraft>(()=>emptyDraft(kind))
  const[saving,setSaving]=useState(false)
  const remove=(index:number)=>setDraft({...draft,questions:draft.questions.filter((_,questionIndex)=>questionIndex!==index).map((question,questionIndex)=>({...question,position:questionIndex+1}))})
  const valid=Boolean(draft.title.trim())&&draft.questions.every((question)=>Boolean(question.text.trim()))
  const save=async()=>{if(!valid||saving)return;setSaving(true);try{await onSave(draft)}finally{setSaving(false)}}
  return <section className="card survey-builder-card">
    <div className="survey-builder-head"><div><span className="eyebrow">{kindLabel(kind)}</span><h2>Создать с нуля</h2><p>Сохраните опрос для повторного использования или отправьте его один раз.</p></div><div className="survey-symbol"><Plus/></div></div>
    <div className="form-stack">
      <label>Название<input value={draft.title} onChange={(event)=>setDraft({...draft,title:event.target.value})} placeholder="Например, Итоги адаптации"/></label>
      <label>Описание<textarea value={draft.description} onChange={(event)=>setDraft({...draft,description:event.target.value})} placeholder="Коротко расскажите, для чего нужен этот опрос"/></label>
      <div className="question-editor is-editing">{draft.questions.map((question,index)=><div key={index}><b>{index+1}</b><input value={question.text} onChange={(event)=>setDraft({...draft,questions:draft.questions.map((row,rowIndex)=>rowIndex===index?{...row,text:event.target.value}:row)})} placeholder="Текст вопроса"/><SelectField value={question.answer_type} options={answerTypeOptions} onChange={(answerType)=>setDraft({...draft,questions:draft.questions.map((row,rowIndex)=>rowIndex===index?{...row,answer_type:answerType as 'text'|'scale'}:row)})} ariaLabel={`Тип ответа на вопрос ${index+1}`}/><button type="button" className="icon-button danger question-delete" disabled={draft.questions.length===1} onClick={()=>remove(index)} aria-label={`Удалить вопрос ${index+1}`} title={draft.questions.length===1?'В опросе должен остаться хотя бы один вопрос':'Удалить вопрос'}><Trash2/></button></div>)}</div>
      <button type="button" className="button add-line" onClick={()=>setDraft({...draft,questions:[...draft.questions,{text:'',answer_type:'text',position:draft.questions.length+1}]})}><Plus/>Добавить вопрос</button>
      <div className="survey-builder-actions"><button type="button" className="button secondary" disabled={!valid||saving} onClick={()=>void save()}><Save/>{saving?'Сохраняем…':'Сохранить в шаблоны'}</button><button type="button" className="button primary" disabled={!valid||saving} onClick={()=>onSend(draft)}><Send/>Отправить разово</button></div>
    </div>
  </section>
}

function TakeSurvey({run,template,subject,onClose,onSubmit}:{run:SurveyRun;template:SurveyTemplate;subject:Profile;onClose:()=>void;onSubmit:(values:Record<number,string>)=>Promise<void>}){
  const[values,setValues]=useState<Record<number,string>>({})
  return <Modal className="survey-take-modal" title={template.title} subtitle={`О сотруднике: ${subject.full_name}`} onClose={onClose} wide><form className="survey-form" onSubmit={(event)=>{event.preventDefault();void onSubmit(values)}}>{template.questions.map((question,index)=><div className="survey-question" key={question.id}><span>Вопрос {index+1} из {template.questions.length}</span><h3>{question.text}</h3>{question.answer_type==='scale'?<div className="scale-answer">{Array.from({length:10},(_,scaleIndex)=>scaleIndex+1).map((number)=><label key={number}><input type="radio" name={`q-${question.id}`} value={number} onChange={()=>setValues({...values,[question.id!]:String(number)})} required/><span>{number}</span></label>)}</div>:<textarea value={values[question.id!]??''} onChange={(event)=>setValues({...values,[question.id!]:event.target.value})} placeholder="Ваш ответ" required/>}</div>)}<button className="button primary">Отправить ответы</button></form></Modal>
}

function SendSurvey({template,profiles,allowSchedule=true,onClose,onSubmit}:{template:Pick<SurveyTemplate,'title'|'kind'>;profiles:Profile[];allowSchedule?:boolean;onClose:()=>void;onSubmit:(profile:Profile,audience:Audience,schedule?:{starts_at:string;frequency:SurveySchedule['frequency'];ends_at:string|null})=>Promise<void>}){
  const[selected,setSelected]=useState(profiles[0]?.id??'')
  const[audience,setAudience]=useState<Audience>(template.kind==='self'?'person':'colleagues')
  const[regular,setRegular]=useState(false)
  const[start,setStart]=useState(new Date().toISOString().slice(0,16))
  const[frequency,setFrequency]=useState<SurveySchedule['frequency']>('monthly')
  const[end,setEnd]=useState('')
  const[sending,setSending]=useState(false)
  const subject=profiles.find((profile)=>profile.id===selected)
  const submit=async()=>{if(!subject||sending)return;setSending(true);try{await onSubmit(subject,audience,allowSchedule&&regular?{starts_at:new Date(start).toISOString(),frequency,ends_at:end?new Date(end).toISOString():null}:undefined)}finally{setSending(false)}}
  return <Modal className="survey-send-modal" title={allowSchedule?'Отправить опрос':'Отправить разово'} subtitle={template.title} onClose={onClose} wide><form className="form-stack" onSubmit={(event)=>{event.preventDefault();void submit()}}><fieldset><legend>О ком опрос</legend><ProfilePicker profiles={profiles} selectedIds={selected?[selected]:[]} onChange={(ids)=>setSelected(ids[0]??'')}/></fieldset><label>Получатели<SelectField value={audience} options={audienceOptions} onChange={(next)=>setAudience(next as Audience)} ariaLabel="Получатели опроса"/></label>{allowSchedule&&<label className="toggle-field"><input type="checkbox" checked={regular} onChange={(event)=>setRegular(event.target.checked)}/><span><b>Отправлять регулярно</b><small>Расписание можно удалить в любой момент</small></span></label>}{allowSchedule&&regular&&<><label>Первая публикация<DateTimeField type="datetime-local" value={start} onChange={setStart} required ariaLabel="Дата и время первой публикации"/></label><label>Повтор<SelectField value={frequency} options={frequencyOptions} onChange={(next)=>setFrequency(next as SurveySchedule['frequency'])} ariaLabel="Периодичность опроса"/></label><label>Завершить после<DateTimeField type="datetime-local" value={end} onChange={setEnd} ariaLabel="Дата и время завершения расписания"/></label></>}<button className="button primary" disabled={!subject||sending}><Send/>{sending?'Отправляем…':allowSchedule&&regular?'Запланировать':allowSchedule?'Отправить сейчас':'Отправить разово'}</button></form></Modal>
}

function EditTemplate({template,initialEditing=false,onClose,onSubmit}:{template:SurveyTemplate;initialEditing?:boolean;onClose:()=>void;onSubmit:(template:SurveyTemplate)=>Promise<void>}){
  const[isEditing,setIsEditing]=useState(initialEditing)
  const[draft,setDraft]=useState<SurveyTemplate>(structuredClone(template))
  const update=(index:number,patch:Partial<SurveyQuestion>)=>setDraft({...draft,questions:draft.questions.map((question,questionIndex)=>questionIndex===index?{...question,...patch}:question)})
  const remove=(index:number)=>setDraft({...draft,questions:draft.questions.filter((_,questionIndex)=>questionIndex!==index).map((question,questionIndex)=>({...question,position:questionIndex+1}))})
  const hasChanges=draft.title!==template.title||draft.description!==template.description||draft.questions.length!==template.questions.length||draft.questions.some((question,index)=>question.text!==template.questions[index]?.text||question.answer_type!==template.questions[index]?.answer_type)
  const isValid=Boolean(draft.title.trim())&&draft.questions.every((question)=>Boolean(question.text.trim()))
  const cancelEditing=()=>{setDraft(structuredClone(template));setIsEditing(false)}
  return <Modal className="survey-template-modal" title={isEditing?'Редактировать шаблон':'Шаблон опроса'} subtitle={isEditing?'Изменения применятся к следующим отправкам':'Просмотр сохранённой версии шаблона'} onClose={onClose} wide><div className={`form-stack template-mode ${isEditing?'is-editing':'is-viewing'}`}><label>Название<input value={draft.title} readOnly={!isEditing} onChange={(event)=>setDraft({...draft,title:event.target.value})}/></label><label>Описание<textarea value={draft.description} readOnly={!isEditing} onChange={(event)=>setDraft({...draft,description:event.target.value})}/></label><div className={`question-editor ${isEditing?'is-editing':''}`}>{draft.questions.map((question,index)=><div key={question.id??index}><b>{index+1}</b><input value={question.text} readOnly={!isEditing} onChange={(event)=>update(index,{text:event.target.value})}/><SelectField value={question.answer_type} options={answerTypeOptions} disabled={!isEditing} onChange={(answerType)=>update(index,{answer_type:answerType as 'text'|'scale'})} ariaLabel={`Тип ответа на вопрос ${index+1}`}/>{isEditing&&<button type="button" className="icon-button danger question-delete" disabled={draft.questions.length===1} onClick={()=>remove(index)} aria-label={`Удалить вопрос ${index+1}`} title={draft.questions.length===1?'В шаблоне должен остаться хотя бы один вопрос':'Удалить вопрос'}><Trash2/></button>}</div>)}</div>{isEditing&&<button type="button" className="button add-line" onClick={()=>setDraft({...draft,questions:[...draft.questions,{text:'Новый вопрос',answer_type:'text',position:draft.questions.length+1}]})}><Plus/>Добавить вопрос</button>}<div className="template-mode-actions">{isEditing?<><button type="button" className="button secondary" onClick={cancelEditing}>Отменить изменения</button><button type="button" className="button primary" disabled={!hasChanges||!isValid} onClick={()=>void onSubmit(draft)}>Сохранить изменения</button></>:<button type="button" className="button primary" onClick={()=>setIsEditing(true)}><Edit3/>Редактировать шаблон</button>}</div></div></Modal>
}

const frequencyLabel=(frequency:SurveySchedule['frequency'])=>({weekly:'Каждую неделю',monthly:'Каждый месяц',quarterly:'Каждый квартал',semiannual:'Раз в полгода',yearly:'Каждый год'}[frequency])

function SurveyResults({run,template,subject,profiles,assignments,answers,onClose}:{run:SurveyRun;template:SurveyTemplate;subject:Profile;profiles:Profile[];assignments:Assignment[];answers:Answer[];onClose:()=>void}){
  const rows=assignments.filter((assignment)=>assignment.run_id===run.id)
  const completed=rows.filter((assignment)=>assignment.completed_at)
  const[first,setFirst]=useState(completed[0]?.respondent_id??'')
  const selected=profiles.find((profile)=>profile.id===first)
  const response=answers.filter((answer)=>answer.run_id===run.id&&answer.respondent_id===first)
  return <Modal className="survey-results-modal" title="Результаты опроса" subtitle={`${subject.full_name} · ${completed.length} из ${rows.length} ответили`} onClose={onClose} wide><div className="results-layout"><aside><h4>Респонденты</h4>{rows.map((assignment)=>{const profile=profiles.find((item)=>item.id===assignment.respondent_id);return <button className={first===assignment.respondent_id?'active':''} key={assignment.respondent_id} disabled={!assignment.completed_at} onClick={()=>setFirst(assignment.respondent_id)}>{profile&&<PersonLine profile={profile}/>}<Badge tone={assignment.completed_at?'green':'gray'}>{assignment.completed_at?'Готово':'Ожидаем'}</Badge></button>})}</aside><div className="answer-detail">{selected?<><h3>{selected.full_name}</h3>{template.questions.map((question)=><div key={question.id}><span>{question.text}</span><strong>{response.find((answer)=>answer.question_id===question.id)?.value??'Нет ответа'}</strong></div>)}</>:<EmptyState icon={<BarChart3/>} title="Ответов пока нет" text="Детальные ответы появятся после заполнения."/>}</div></div></Modal>
}
