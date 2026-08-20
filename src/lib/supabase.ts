import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && key && !url?.includes('YOUR_PROJECT'))
export const supabase = isSupabaseConfigured ? createClient(url!, key!) : null

const ru: Record<string, string> = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',
  к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
  х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
}
export const loginToEmail = (login: string) => {
  const local = [...login.trim().toLocaleLowerCase('ru-RU')]
    .map((char) => ru[char] ?? char).join('').replace(/[^a-z0-9._-]/g, '.')
  return `${local}@korpus-demo.ru`
}
