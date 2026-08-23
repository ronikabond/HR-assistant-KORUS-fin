import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type EmployeeInput = {
  login: string
  password: string
  full_name: string
  job_title?: string
  department?: string
  direction?: string
  corporate_email?: string
  phone?: string
  hired_on?: string
  is_hr?: boolean
  is_head_hr?: boolean
  hr_id?: string | null
  manager_id?: string | null
}

const ru: Record<string, string> = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',
  к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
  х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
}
const normalizeEmail = (login: string) => {
  const local = [...login.trim().toLocaleLowerCase('ru-RU')]
    .map((char) => ru[char] ?? char).join('').replace(/[^a-z0-9._-]/g, '.')
  return `${local}@korpus-demo.ru`
}

// Этапы адаптации по ТЗ: день 1 и неделя 1 — HR и сотрудник; 1,5 и 3 месяца — HR, руководитель и сотрудник.
const ONBOARDING_SCHEDULE = [
  { title: 'Первый день', kind: 'first_day', offsetDays: 0, withManager: false },
  { title: 'Итоги первой недели', kind: 'first_week', offsetDays: 7, withManager: false },
  { title: 'Промежуточная встреча', kind: 'midpoint', offsetDays: 45, withManager: true },
  { title: 'Итоги испытательного срока', kind: 'probation_end', offsetDays: 90, withManager: true },
] as const

// Подбираем ближайший свободный получасовой слот для организатора/руководителя в этот день —
// иначе при совпадении этапов у разных сотрудников (например, у одного HR) встречи накладываются
// друг на друга на одно и то же время. Логика зеркалит private.k_free_meeting_slot в миграциях.
// deno-lint-ignore no-explicit-any
async function findFreeSlot(admin: any, day: Date, participantIds: (string | null)[]) {
  const busyParticipants = participantIds.filter(Boolean) as string[]
  for (let step = 0; step <= 12; step++) {
    const candidate = new Date(day); candidate.setUTCMinutes(candidate.getUTCMinutes() + step * 30)
    const { count } = await admin.from('k_meeting_participants').select('meeting_id, k_meetings!inner(scheduled_for)', { count: 'exact', head: true })
      .in('profile_id', busyParticipants).eq('k_meetings.scheduled_for', candidate.toISOString())
    if (!count) return candidate
  }
  const fallback = new Date(day); fallback.setUTCMinutes(fallback.getUTCMinutes() + 12 * 30); return fallback
}

// deno-lint-ignore no-explicit-any
async function insertMeeting(admin: any, employeeId: string, organizerId: string, participantIds: (string | null)[], title: string, kind: string, date: Date) {
  const slot = await findFreeSlot(admin, date, [organizerId, ...participantIds])
  const { data: meeting, error } = await admin.from('k_meetings').insert({
    title, employee_id: employeeId, organizer_id: organizerId, meeting_type: kind, scheduled_for: slot.toISOString(),
  }).select('id').single()
  if (error) throw error
  const participants = participantIds.filter(Boolean)
  const { error: participantsError } = await admin.from('k_meeting_participants')
    .insert(participants.map((profile_id) => ({ meeting_id: meeting.id, profile_id })))
  if (participantsError) throw participantsError
}

// Платформа иногда выполняет запрос дважды параллельно на холодном старте (гонка изолятов) —
// защищаемся от задвоения графика встреч простой проверкой «уже создано?» перед вставкой.
// deno-lint-ignore no-explicit-any
async function scheduleAlreadyExists(admin: any, employeeId: string, kind: string) {
  const { count } = await admin.from('k_meetings').select('id', { count: 'exact', head: true })
    .eq('employee_id', employeeId).eq('meeting_type', kind)
  return (count ?? 0) > 0
}

// deno-lint-ignore no-explicit-any
async function createOnboardingMeetings(admin: any, employeeId: string, hrId: string, managerId: string | null, hiredOn: string) {
  if (await scheduleAlreadyExists(admin, employeeId, 'first_day')) return
  for (const stage of ONBOARDING_SCHEDULE) {
    const date = new Date(`${hiredOn}T11:00:00Z`); date.setUTCDate(date.getUTCDate() + stage.offsetDays)
    if (date.getTime() < Date.now()) continue
    await insertMeeting(admin, employeeId, hrId, [employeeId, hrId, stage.withManager ? managerId : null], stage.title, stage.kind, date)
  }
}

// «После постановки ИПР» (по сценарию — сразу по итогам испытательного срока, hired_on + 90 дней):
// промежуточная встреча через полгода, итоговая годовая встреча, далее ежегодный цикл.
// Настоящей бесконечной повторяемости пока нет (в проекте нет cron/scheduled-функций) —
// предсоздаём цикл на DEVELOPMENT_CYCLE_YEARS лет вперёд, этого достаточно, чтобы показать сам цикл.
const DEVELOPMENT_CYCLE_YEARS = 2
// deno-lint-ignore no-explicit-any
async function createDevelopmentCycleMeetings(admin: any, employeeId: string, hrId: string, managerId: string | null, hiredOn: string) {
  if (await scheduleAlreadyExists(admin, employeeId, 'ipr_checkin')) return
  const probationEnd = new Date(`${hiredOn}T11:00:00Z`); probationEnd.setUTCDate(probationEnd.getUTCDate() + 90)
  for (let half = 1; half <= DEVELOPMENT_CYCLE_YEARS * 2; half++) {
    const date = new Date(probationEnd); date.setUTCMonth(date.getUTCMonth() + half * 6)
    const isAnnual = half % 2 === 0
    const title = isAnnual ? 'Итоговая годовая встреча по ИПР' : 'Промежуточная встреча по ИПР'
    const kind = isAnnual ? 'annual_review' : 'ipr_checkin'
    if (date.getTime() < Date.now()) continue
    await insertMeeting(admin, employeeId, hrId, [employeeId, hrId, managerId], title, kind, date)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  })

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    const payload = await req.json()
    const action = payload.action as string

    if (action === 'accounts') {
      const { data, error } = await admin.from('k_demo_accounts')
        .select('login,demo_password,full_name,job_title,role_label').eq('is_active', true).order('full_name')
      if (error) throw error
      return reply({ accounts:data ?? [] })
    }

    if (action === 'bootstrap') {
      const { count } = await admin.from('k_profiles').select('id', { count: 'exact', head: true })
      if ((count ?? 0) > 0) return reply({ error: 'Демонстрационные аккаунты уже созданы' }, 409)

      const passwords = JSON.parse(Deno.env.get('KORUS_DEMO_PASSWORDS_JSON') ?? '{}') as Record<string, string>
      const passwordFor = (key: string) => {
        const password = passwords[key]
        if (!password || password.length < 6) throw new Error(`Не задан безопасный пароль для ${key}`)
        return password
      }

      const people: Array<EmployeeInput & { key: string }> = [
        { key:'head', login:'НРглавный', password:passwordFor('head'), full_name:'Ксения Никитина', job_title:'Главный HR-партнёр', department:'HR', hired_on:'2024-03-04', is_hr:true, is_head_hr:true },
        { key:'hr1', login:'НР1_2026', password:passwordFor('hr1'), full_name:'Анна Орлова', job_title:'HR-партнёр', department:'HR', hired_on:'2024-09-16', is_hr:true },
        { key:'hr2', login:'НР2_2026', password:passwordFor('hr2'), full_name:'Татьяна Волкова', job_title:'HR-партнёр', department:'HR', hired_on:'2025-01-13', is_hr:true },
        { key:'m1', login:'руководитель1', password:passwordFor('m1'), full_name:'Михаил Соколов', job_title:'Руководитель проектов', department:'Цифровые решения', hired_on:'2023-05-22' },
        { key:'m2', login:'руководитель2', password:passwordFor('m2'), full_name:'Елена Морозова', job_title:'Руководитель группы', department:'Разработка', hired_on:'2023-11-06' },
        { key:'m3', login:'руководитель3', password:passwordFor('m3'), full_name:'Алексей Лебедев', job_title:'Ведущий аналитик', department:'Аналитика', hired_on:'2024-06-17' },
        { key:'e1', login:'сотрудник1', password:passwordFor('e1'), full_name:'Савелий Адаев', job_title:'Младший бизнес-аналитик', department:'Разработка', hired_on:'2026-06-01' },
        { key:'e2', login:'сотрудник2', password:passwordFor('e2'), full_name:'Мария Белова', job_title:'Стажёр-разработчик', department:'Разработка', hired_on:'2026-07-13' },
        { key:'e3', login:'сотрудник3', password:passwordFor('e3'), full_name:'Илья Воронов', job_title:'Стажёр проекта', department:'Цифровые решения', hired_on:'2026-05-18' },
        { key:'e4', login:'сотрудник4', password:passwordFor('e4'), full_name:'Дарья Кузнецова', job_title:'Младший аналитик', department:'Разработка', hired_on:'2026-08-03' },
      ]

      const ids: Record<string, string> = {}
      for (const person of people) {
        const { data, error } = await admin.auth.admin.createUser({
          email: normalizeEmail(person.login), password: person.password,
          email_confirm: true, app_metadata: { app: 'korpus-hr' },
        })
        if (error) throw error
        ids[person.key] = data.user.id
        const { error: profileError } = await admin.from('k_profiles').insert({
          id: data.user.id, login: person.login, full_name: person.full_name,
          job_title: person.job_title, department: person.department,
          hired_on: person.hired_on, is_hr: person.is_hr ?? false,
          is_head_hr: person.is_head_hr ?? false,
        })
        if (profileError) throw profileError
        const roleLabel = person.is_head_hr ? 'Администратор' : person.is_hr ? 'HR' : person.key.startsWith('m') ? 'Руководитель' : 'Сотрудник'
        const { error: demoError } = await admin.from('k_demo_accounts').insert({
          profile_id:data.user.id, login:person.login, demo_password:person.password,
          full_name:person.full_name, job_title:person.job_title ?? '', role_label:roleLabel,
        })
        if (demoError) throw demoError
      }

      const relations: Record<string, { hr?: string, manager?: string }> = {
        hr1:{hr:'head'}, hr2:{hr:'head'}, m1:{hr:'head'},
        m2:{hr:'hr1'}, m3:{hr:'hr2'},
        e1:{hr:'hr1',manager:'m2'}, e2:{hr:'hr1',manager:'m2'},
        e3:{hr:'hr2',manager:'m1'}, e4:{hr:'hr2',manager:'m2'},
      }
      for (const [key, relation] of Object.entries(relations)) {
        const { error } = await admin.from('k_profiles').update({
          hr_id: relation.hr ? ids[relation.hr] : null,
          manager_id: relation.manager ? ids[relation.manager] : null,
        }).eq('id', ids[key])
        if (error) throw error
      }

      for (const key of ['hr1','hr2','m1','m2','m3','e1','e2','e3','e4']) {
        const person = people.find((p) => p.key === key)!
        const rel = relations[key] ?? {}
        if (!rel.hr) continue
        await createOnboardingMeetings(admin, ids[key], ids[rel.hr], rel.manager ? ids[rel.manager] : null, person.hired_on!)
        await createDevelopmentCycleMeetings(admin, ids[key], ids[rel.hr], rel.manager ? ids[rel.manager] : null, person.hired_on!)
      }

      const demoTasks = [
        { employee_id:ids.e1, section:'Проектная деятельность', title:'Погружение в проект и процессы заказчика', description:'Изучить архитектуру решения и принять участие в проектных встречах.', expected_result:'Самостоятельно вести одну аналитическую задачу.', status:'approved', proposed_by:ids.m2 },
        { employee_id:ids.e1, section:'Развитие навыков и компетенций', title:'Развить навык подготовки требований', description:'Подготовить спецификацию и провести ревью с руководителем.', expected_result:'Согласованная спецификация без критичных замечаний.', status:'approved', proposed_by:ids.e1, decided_by:ids.m2, decided_at:new Date().toISOString() },
        { employee_id:ids.e2, section:'Сертификация вендоров', title:'Пройти базовый курс PostgreSQL', description:'Изучить материалы и выполнить итоговое задание.', expected_result:'Сертификат о прохождении курса.', status:'pending', proposed_by:ids.e2 },
        { employee_id:ids.e4, section:'Маркетинг', title:'Подготовить статью для базы знаний', description:'Описать опыт первой проектной задачи.', expected_result:'Черновик статьи.', status:'rejected', proposed_by:ids.e4, decided_by:ids.m2, decided_at:new Date().toISOString(), rejection_reason:'Сначала завершим адаптационный план.' },
      ]
      await admin.from('k_ipr_tasks').insert(demoTasks)

      await admin.from('k_chat_messages').insert([
        {employee_id:ids.e1,author_id:ids.hr1,body:'Савелий, добро пожаловать! Здесь будем обсуждать адаптацию и встречи.'},
        {employee_id:ids.e1,author_id:ids.e1,body:'Спасибо! Я уже посмотрел материалы и добавил первую задачу в ИПР.'},
        {employee_id:ids.e1,author_id:ids.m2,body:'Отлично. На встрече сверим ожидаемый результат.'},
      ])
      await admin.from('k_notifications').insert([
        {recipient_id:ids.e1,kind:'meeting_reminder',title:'Встреча через неделю',body:'Промежуточная встреча — проверьте дату в календаре.'},
        {recipient_id:ids.m2,kind:'ipr_request',title:'Новая задача на согласовании',body:'Мария Белова добавила задачу в ИПР.'},
      ])

      return reply({ ok:true, accounts:people.map(({login,password}) => ({login,password})) })
    }

    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return reply({ error:'Необходима авторизация' }, 401)
    const { data: authData, error: authError } = await admin.auth.getUser(token)
    if (authError || !authData.user) return reply({ error:'Сессия недействительна' }, 401)
    const { data: actor } = await admin.from('k_profiles').select('*').eq('id', authData.user.id).single()
    if (!actor?.is_hr) return reply({ error:'Доступно только HR' }, 403)

    if (action === 'create') {
      const employee = payload.employee as EmployeeInput
      if (!employee.login || !employee.password || !employee.full_name) return reply({ error:'Заполните логин, пароль и ФИО' }, 400)
      const { data, error } = await admin.auth.admin.createUser({
        email:normalizeEmail(employee.login), password:employee.password, email_confirm:true,
        app_metadata:{app:'korpus-hr'},
      })
      if (error) throw error
      const { error: profileError } = await admin.from('k_profiles').insert({
        id:data.user.id, login:employee.login, full_name:employee.full_name,
        job_title:employee.job_title ?? '', department:employee.department ?? '',
        direction:employee.direction ?? '', corporate_email:employee.corporate_email ?? '', phone:employee.phone ?? '',
        hired_on:employee.hired_on, is_hr:employee.is_hr ?? false, is_head_hr:employee.is_head_hr ?? false,
        hr_id:employee.hr_id || null, manager_id:employee.manager_id || null,
      })
      if (profileError) { await admin.auth.admin.deleteUser(data.user.id); throw profileError }
      const roleLabel = employee.is_head_hr ? 'Администратор' : employee.is_hr ? 'HR' : 'Сотрудник'
      const { error: demoError } = await admin.from('k_demo_accounts').insert({
        profile_id:data.user.id, login:employee.login, demo_password:employee.password,
        full_name:employee.full_name, job_title:employee.job_title ?? '', role_label:roleLabel,
      })
      if (demoError) { await admin.auth.admin.deleteUser(data.user.id); throw demoError }
      // Онбординг-встречи уже создаёт БД-триггер k_seed_onboarding_meetings (AFTER INSERT ON k_profiles,
      // срабатывает т.к. hr_id передан прямо при вставке выше) — здесь досоздаём только годовой цикл ИПР,
      // которого триггер не знает.
      if (employee.hr_id && employee.hired_on) {
        await createDevelopmentCycleMeetings(admin, data.user.id, employee.hr_id, employee.manager_id ?? null, employee.hired_on)
      }
      for (const partnerId of [...new Set([employee.hr_id,employee.manager_id].filter(Boolean) as string[])]) {
        const { data:partner } = await admin.from('k_profiles').select('full_name').eq('id',partnerId).single()
        const { data:chat,error:chatError } = await admin.from('k_chats').insert({
          title:partner?.full_name ?? 'Рабочий чат', created_by:data.user.id, is_group:false,
        }).select('id').single()
        if (chatError) throw chatError
        const { error:membersError } = await admin.from('k_chat_participants').insert([
          {chat_id:chat.id,profile_id:data.user.id},{chat_id:chat.id,profile_id:partnerId},
        ])
        if (membersError) throw membersError
      }
      return reply({ ok:true, id:data.user.id })
    }

    if (action === 'delete') {
      const targetId = String(payload.id ?? '')
      const { data: target } = await admin.from('k_profiles').select('hr_id').eq('id', targetId).single()
      if (!target || (!actor.is_head_hr && target.hr_id !== actor.id)) return reply({ error:'Можно удалить только своего сотрудника' }, 403)
      const { error: profileError } = await admin.from('k_profiles').update({is_active:false}).eq('id',targetId)
      if (profileError) throw profileError
      const { error: accountError } = await admin.from('k_demo_accounts').update({is_active:false}).eq('profile_id',targetId)
      if (accountError) throw accountError
      const { error } = await admin.auth.admin.updateUserById(targetId,{ban_duration:'876000h'})
      if (error) throw error
      return reply({ ok:true })
    }
    return reply({ error:'Неизвестное действие' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message
      : (typeof error === 'object' && error && 'message' in error) ? String((error as { message: unknown }).message)
      : 'Ошибка сервера'
    return reply({ error: message }, 500)
  }
})
