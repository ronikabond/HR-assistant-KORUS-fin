import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { Meeting, Profile } from '../types'

const STAGES = [
  { kind: 'first_day', label: 'Первый день', offsetDays: 0 },
  { kind: 'first_week', label: 'Итоги недели', offsetDays: 7 },
  { kind: 'midpoint', label: '1,5 месяца', offsetDays: 45 },
  { kind: 'probation_end', label: 'Итоги срока', offsetDays: 90 },
] as const

export function OnboardingStepper({ employee, meetings }: { employee: Profile; meetings: Meeting[] }) {
  if (!employee.hired_on) return null
  const hiredOn = new Date(`${employee.hired_on}T00:00:00`)
  const now = new Date()
  const stages = STAGES.map((stage) => {
    const meeting = meetings.find((m) => m.employee_id === employee.id && m.meeting_type === stage.kind)
    const date = meeting ? new Date(meeting.scheduled_for) : new Date(hiredOn.getTime() + stage.offsetDays * 86400000)
    return { ...stage, date, done: date < now }
  })
  const currentIndex = stages.findIndex((s) => !s.done)

  const items: ReactNode[] = []
  stages.forEach((stage, i) => {
    if (i > 0) items.push(<div key={`line-${stage.kind}`} className={`stepper-line ${stages[i - 1].done ? 'stepper-line-done' : ''}`} />)
    const state = stage.done ? 'done' : i === currentIndex ? 'current' : 'upcoming'
    items.push(
      <div key={stage.kind} className={`stepper-step stepper-${state}`}>
        <div className="stepper-dot">{stage.done ? <Check /> : i + 1}</div>
        <span className="stepper-label">{stage.label}</span>
        <small className="stepper-date">{stage.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</small>
      </div>,
    )
  })

  return <div className="onboarding-stepper-wrap"><span className="eyebrow">Этап адаптации</span><div className="onboarding-stepper">{items}</div></div>
}
