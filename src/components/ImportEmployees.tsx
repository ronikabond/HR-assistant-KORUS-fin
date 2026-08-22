import { useRef, useState } from 'react'
import { CheckCircle2, FileUp, Upload, XCircle } from 'lucide-react'
import type { Profile } from '../types'
import { Modal } from './UI'

type ParsedRow = {
  full_name: string; login: string; password: string; job_title: string; department: string
  hired_on: string; corporate_email: string; phone: string; hr_id: string | null; manager_id: string | null
  error: string | null
}

const REQUIRED_COLUMNS = ['фио', 'логин', 'пароль', 'дата выхода']

// «Создать N сотрудников» — винительный падеж одушевлённого существительного:
// для 1 родительный ед.ч. («сотрудника»), для остальных родительный мн.ч. («сотрудников»).
function pluralizeEmployees(count: number): string {
  const mod100 = count % 100
  return count % 10 === 1 && mod100 !== 11 ? 'сотрудника' : 'сотрудников'
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''; let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') { inQuotes = !inQuotes; continue }
    if (char === delimiter && !inQuotes) { cells.push(current.trim()); current = ''; continue }
    current += char
  }
  cells.push(current.trim())
  return cells
}

function parseCsv(text: string, profiles: Profile[]): { rows: ParsedRow[]; missingColumns: string[] } {
  const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.trim())
  if (!lines.length) return { rows: [], missingColumns: REQUIRED_COLUMNS }
  const delimiter = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ','
  const headers = splitCsvLine(lines[0], delimiter).map((h) => h.toLowerCase())
  const missingColumns = REQUIRED_COLUMNS.filter((needed) => !headers.includes(needed))
  if (missingColumns.length) return { rows: [], missingColumns }
  const index = (name: string) => headers.indexOf(name)
  const findByName = (name: string) => profiles.find((p) => p.full_name.trim().toLowerCase() === name.trim().toLowerCase())

  const rows: ParsedRow[] = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delimiter)
    const get = (name: string) => (index(name) >= 0 ? (cells[index(name)] ?? '').trim() : '')
    const full_name = get('фио'); const login = get('логин'); const password = get('пароль'); const hired_on = get('дата выхода')
    const hrName = get('hr'); const managerName = get('руководитель')
    const hr = hrName ? findByName(hrName) : undefined
    const manager = managerName ? findByName(managerName) : undefined
    let error: string | null = null
    if (!full_name) error = 'Не указано ФИО'
    else if (login.length < 6) error = 'Логин короче 6 символов'
    else if (password.length < 6) error = 'Пароль короче 6 символов'
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(hired_on)) error = 'Дата выхода должна быть в формате ГГГГ-ММ-ДД'
    else if (hrName && !hr) error = `HR «${hrName}» не найден среди сотрудников`
    else if (managerName && !manager) error = `Руководитель «${managerName}» не найден среди сотрудников`
    return {
      full_name, login, password, job_title: get('должность'), department: get('департамент'),
      hired_on, corporate_email: get('почта'), phone: get('телефон'),
      hr_id: hr?.id ?? null, manager_id: manager?.id ?? null, error,
    }
  })
  return { rows, missingColumns: [] }
}

export function ImportEmployees({ profiles, onClose, onCreateOne, onFinished }: {
  profiles: Profile[]; onClose: () => void
  onCreateOne: (employee: Record<string, unknown>) => Promise<void>
  onFinished: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [missingColumns, setMissingColumns] = useState<string[]>([])
  const [results, setResults] = useState<Record<number, 'ok' | 'error'> | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleFile = async (file: File) => {
    const text = await file.text()
    const parsed = parseCsv(text, profiles)
    setRows(parsed.rows); setMissingColumns(parsed.missingColumns); setResults(null)
  }

  const validRows = (rows ?? []).filter((row) => !row.error)
  const submit = async () => {
    setSubmitting(true)
    const outcome: Record<number, 'ok' | 'error'> = {}
    for (const [i, row] of (rows ?? []).entries()) {
      if (row.error) continue
      try {
        await onCreateOne({
          full_name: row.full_name, login: row.login, password: row.password,
          job_title: row.job_title, department: row.department, hired_on: row.hired_on,
          corporate_email: row.corporate_email, phone: row.phone,
          hr_id: row.hr_id, manager_id: row.manager_id,
        })
        outcome[i] = 'ok'
      } catch { outcome[i] = 'error' }
    }
    setResults(outcome); setSubmitting(false); onFinished()
  }

  return <Modal title="Импортировать сотрудников из файла" subtitle="CSV с разделителем «,» или «;», первая строка — заголовки" onClose={onClose} wide>
    {!rows && <div className="import-drop">
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])}/>
      <FileUp/>
      <p>Обязательные столбцы: <b>ФИО, Логин, Пароль, Дата выхода</b> (ГГГГ-ММ-ДД).<br/>Необязательные: Должность, Департамент, Почта, Телефон, HR, Руководитель — HR и Руководителя указывайте точным ФИО уже существующего сотрудника.</p>
      <button type="button" className="button primary" onClick={() => fileRef.current?.click()}><Upload/>Выбрать файл</button>
      {missingColumns.length > 0 && <div className="form-error">В файле не хватает столбцов: {missingColumns.join(', ')}</div>}
    </div>}

    {rows && <>
      <div className="import-summary"><span>Строк: {rows.length}</span><span>Готово к загрузке: {validRows.length}</span><span>С ошибками: {rows.length - validRows.length}</span></div>
      <div className="import-table-wrap"><table className="import-table"><thead><tr><th>ФИО</th><th>Логин</th><th>Дата выхода</th><th>HR</th><th>Руководитель</th><th>Статус</th></tr></thead><tbody>
        {rows.map((row, i) => <tr key={i} className={row.error ? 'row-error' : ''}>
          <td>{row.full_name || '—'}</td><td>{row.login || '—'}</td><td>{row.hired_on || '—'}</td>
          <td>{row.hr_id ? '✓' : '—'}</td><td>{row.manager_id ? '✓' : '—'}</td>
          <td>{results ? (results[i] === 'ok' ? <CheckCircle2 className="import-ok"/> : results[i] === 'error' ? <XCircle className="import-fail"/> : '—')
            : row.error ? <small>{row.error}</small> : 'Готово'}</td>
        </tr>)}
      </tbody></table></div>
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={onClose}>{results ? 'Закрыть' : 'Отмена'}</button>
        {!results && <button type="button" className="button primary" disabled={!validRows.length || submitting} onClick={() => void submit()}>
          {submitting ? 'Загружаем…' : `Создать ${validRows.length} ${pluralizeEmployees(validRows.length)}`}
        </button>}
      </div>
    </>}
  </Modal>
}
