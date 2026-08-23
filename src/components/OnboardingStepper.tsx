import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { Meeting, Profile } from '../types'

const ONBOARDING_STAGES = [
  { kind: 'first_day', label: 'Первый день', offsetDays: 0 },
  { kind: 'first_week', label: 'Итоги недели', offsetDays: 7 },
  { kind: 'midpoint', label: '1,5 месяца', offsetDays: 45 },
  { kind: 'probation_end', label: 'Итоги срока', offsetDays: 90 },
] as const

// Зеркалит цикл ИПР из createDevelopmentCycleMeetings (edge-функция k-employee-admin):
// от даты окончания испытательного срока (hired_on + 90 дней) далее каждые полгода,
// чередуя промежуточную и годовую встречу — предсоздано на 2 года вперёд.
const DEVELOPMENT_STAGES = [
  { kind: 'ipr_checkin', label: 'Через 6 мес.', monthsAfterProbation: 6 },
  { kind: 'annual_review', label: 'Итоги года', monthsAfterProbation: 12 },
  { kind: 'ipr_checkin', label: 'Через 1,5 года', monthsAfterProbation: 18 },
  { kind: 'annual_review', label: 'Итоги 2 лет', monthsAfterProbation: 24 },
] as const

export function OnboardingStepper({ employee, meetings }: { employee: Profile; meetings: Meeting[] }) {
  if (!employee.hired_on) return null
  const hiredOn = new Date(`${employee.hired_on}T00:00:00`)
  const now = new Date()
  const own = meetings.filter((m) => m.employee_id === employee.id)

  const onboarding = ONBOARDING_STAGES.map((stage) => {
    const meeting = own.find((m) => m.meeting_type === stage.kind)
    const date = meeting ? new Date(meeting.scheduled_for) : new Date(hiredOn.getTime() + stage.offsetDays * 86400000)
    return { key: stage.kind, label: stage.label, date, done: date < now }
  })

  const probationEnd = new Date(hiredOn.getTime() + 90 * 86400000)
  const devMeetings = own
    .filter((m) => m.meeting_type === 'ipr_checkin' || m.meeting_type === 'annual_review')
    .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
  const development = DEVELOPMENT_STAGES.map((stage, i) => {
    const meeting = devMeetings[i]
    const date = meeting ? new Date(meeting.scheduled_for) : new Date(probationEnd)
    if (!meeting) date.setMonth(date.getMonth() + stage.monthsAfterProbation)
    return { key: `${stage.kind}-${i}`, label: stage.label, date, done: date < now }
  })

  const stages = [...onboarding, ...development]
  const currentIndex = stages.findIndex((s) => !s.done)

  const items: ReactNode[] = []
  stages.forEach((stage, i) => {
    if (i > 0) items.push(<div key={`line-${stage.key}`} className={`stepper-line ${stages[i - 1].done ? 'stepper-line-done' : ''}`} />)
    const state = stage.done ? 'done' : i === currentIndex ? 'current' : 'upcoming'
    items.push(
      <div key={stage.key} className={`stepper-step stepper-${state}`}>
        <div className="stepper-dot">{stage.done ? <Check /> : i + 1}</div>
        <span className="stepper-label">{stage.label}</span>
        <small className="stepper-date">{stage.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</small>
      </div>,
    )
  })

  return <div className="onboarding-stepper-wrap"><span className="eyebrow">Этап адаптации и развития</span><div className="onboarding-stepper">{items}</div></div>
}
