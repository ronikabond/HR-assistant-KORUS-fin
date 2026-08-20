import type { AccessScope, Profile } from '../types'
import { ProfilePicker } from './ProfilePicker'

export type ShareDraft={access_scope:AccessScope;department:string|null;recipient_ids:string[];team_employee_id?:string}

export function AccessEditor({profiles,value,onChange}:{profiles:Profile[];value:ShareDraft;onChange:(value:ShareDraft)=>void}){
  const departments=[...new Set(profiles.map((p)=>p.department).filter(Boolean))].sort()
  const selectTeam=(employeeId:string)=>{const employee=profiles.find((p)=>p.id===employeeId);onChange({...value,team_employee_id:employeeId,recipient_ids:[...new Set([employeeId,employee?.hr_id,employee?.manager_id].filter(Boolean) as string[])]})}
  return <div className="access-editor"><label>Кому доступно<select value={value.access_scope} onChange={(e)=>onChange({...value,access_scope:e.target.value as AccessScope,recipient_ids:[],department:null,team_employee_id:''})}><option value="private">Только мне</option><option value="employee_team">Сотруднику, его HR и руководителю</option><option value="people">Конкретным сотрудникам</option><option value="department">Департаменту</option><option value="office">Всему офису</option></select></label>
    {value.access_scope==='employee_team'&&<fieldset><legend>Сотрудник</legend><ProfilePicker profiles={profiles.filter((p)=>!p.is_hr)} selectedIds={value.team_employee_id?[value.team_employee_id]:[]} onChange={(ids)=>selectTeam(ids[0]??'')}/></fieldset>}
    {value.access_scope==='department'&&<label>Департамент<select value={value.department??''} onChange={(e)=>onChange({...value,department:e.target.value})} required><option value="">Выберите департамент</option>{departments.map((department)=><option key={department}>{department}</option>)}</select></label>}
    {value.access_scope==='people'&&<ProfilePicker profiles={profiles} selectedIds={value.recipient_ids} onChange={(recipient_ids)=>onChange({...value,recipient_ids})} multiple/>}
  </div>
}
