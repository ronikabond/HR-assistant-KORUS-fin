export type Id = string

export interface Profile {
  id: Id
  login: string
  full_name: string
  job_title: string
  department: string
  telegram_url: string | null
  corporate_email: string
  phone: string
  direction: string
  hired_on: string
  is_hr: boolean
  is_head_hr: boolean
  manager_id: Id | null
  hr_id: Id | null
  is_active?: boolean
}

export interface EmployeeDirectoryEntry {
  id: Id
  full_name: string
  job_title: string
  department?: string
  is_active?: boolean
}

export interface EmployeeAssignmentEntry extends EmployeeDirectoryEntry {
  is_hr: boolean
}

export type IprStatus = 'pending' | 'approved' | 'rejected'
export interface IprTask {
  id: number
  employee_id: Id
  section: string
  title: string
  description: string
  expected_result: string
  status: IprStatus
  proposed_by: Id
  rejection_reason: string | null
  created_at: string
  is_completed: boolean
  completed_at: string | null
}

export interface Meeting {
  id: number
  title: string
  employee_id: Id
  organizer_id: Id
  meeting_type: string
  scheduled_for: string
  duration_minutes: number
  status: 'planned' | 'reschedule_requested' | 'cancelled'
  participant_ids?: Id[]
  participant_roles?: Record<Id, MeetingParticipationRole>
  participant_statuses?: Record<Id, MeetingParticipationStatus>
}

export type MeetingParticipationRole = 'employee' | 'hr' | 'manager' | 'participant'
export type MeetingParticipationStatus = 'pending' | 'accepted' | 'declined'

export interface RescheduleRequest {
  id: number
  meeting_id: number
  requested_by: Id
  proposed_for: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
}

export interface Chat {
  id: number
  title: string
  created_by: Id
  is_group: boolean
  created_at: string
  participant_ids?: Id[]
  participants?: Array<{ id: Id; full_name: string }>
  last_read_at?: Record<Id, string | null>
}

export interface ChatMessage {
  id: number
  chat_id: number
  author_id: Id
  body: string
  created_at: string
}

export interface Notification {
  id: number
  recipient_id: Id
  kind: string
  title: string
  body: string
  is_read: boolean
  dismissible: boolean
  created_at: string
}

export interface SurveyTemplate {
  id: number
  kind: 'self' | 'colleagues' | 'custom'
  title: string
  description: string
  questions: SurveyQuestion[]
  is_active?: boolean
}

export interface SurveyQuestion {
  id?: number
  text: string
  answer_type: 'text' | 'scale'
  position: number
}

export interface SurveyRun {
  id: number
  template_id: number
  subject_id: Id
  created_by: Id
  status: 'active' | 'closed'
  created_at: string
  template?: SurveyTemplate
}

export interface SurveySchedule {
  id: number
  template_id: number
  subject_id: Id
  created_by: Id
  audience: 'person' | 'colleagues' | 'all'
  starts_at: string
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly'
  ends_at: string | null
  is_active: boolean
  created_at: string
}

export type AccessScope = 'private' | 'employee_team' | 'people' | 'department' | 'office'

export interface DocumentItem {
  id: number
  owner_id: Id
  title: string
  file_name: string
  storage_path: string
  mime_type: string
  size_bytes: number
  access_scope: AccessScope
  department: string | null
  created_at: string
  recipient_ids?: Id[]
}

export interface ResourceLink {
  id: number
  owner_id: Id
  title: string
  url: string
  description: string
  access_scope: AccessScope
  department: string | null
  created_at: string
  recipient_ids?: Id[]
}

export type ViewName = 'home' | 'calendar' | 'ipr' | 'people' | 'team' | 'surveys' | 'chats' | 'documents' | 'links'
