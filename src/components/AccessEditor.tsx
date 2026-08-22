import type { AccessScope, Profile } from '../types'
import { ProfilePicker } from './ProfilePicker'
import { SelectField } from './SelectField'

export type ShareDraft={access_scope:AccessScope;department:string|null;recipient_ids:string[];team_employee_id?:string}

export function AccessEditor({profiles,value,onChange}:{profiles:Profile[];value:ShareDraft;onChange:(value:ShareDraft)=>void}){
  const departments=[...new Set(profiles.map((p)=>p.department).filter((department):department is string=>Boolean(department)))].sort()
  const selectTeam=(employeeId:string)=>{const employee=profiles.find((p)=>p.id===employeeId);onChange({...value,team_employee_id:employeeId,recipient_ids:[...new Set([employeeId,employee?.hr_id,employee?.manager_id].filter(Boolean) as string[])]})}
  return <div className="access-editor"><label>Кому доступно<SelectField value={value.access_scope} options={[{value:'private',label:'Только мне'},{value:'employee_team',label:'Сотруднику, его HR и руководителю'},{value:'people',label:'Конкретным сотрудникам'},{value:'department',label:'Департаменту'},{value:'office',label:'Всему офису'}]} onChange={(access_scope)=>onChange({...value,access_scope:access_scope as AccessScope,recipient_ids:[],department:null,team_employee_id:''})} ariaLabel="Кому доступно"/></label>
    {value.access_scope==='employee_team'&&<fieldset><legend>Сотрудник</legend><ProfilePicker profiles={profiles.filter((p)=>!p.is_hr)} selectedIds={value.team_employee_id?[value.team_employee_id]:[]} onChange={(ids)=>selectTeam(ids[0]??'')}/></fieldset>}
    {value.access_scope==='department'&&<label>Департамент<SelectField value={value.department??''} options={[{value:'',label:'Выберите департамент'},...departments.map((department)=>({value:department,label:department}))]} onChange={(department)=>onChange({...value,department})} required ariaLabel="Департамент"/></label>}
    {value.access_scope==='people'&&<ProfilePicker profiles={profiles} selectedIds={value.recipient_ids} onChange={(recipient_ids)=>onChange({...value,recipient_ids})} multiple/>}
  </div>
}
