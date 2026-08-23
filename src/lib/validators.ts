export const EMAIL_PATTERN = '[^\\s@]+@[^\\s@]+\\.[^\\s@]+'
export const PHONE_PATTERN = '[+]?[0-9\\s()-]{10,18}'

export const EMAIL_RE = new RegExp(`^${EMAIL_PATTERN}$`)
export const PHONE_RE = new RegExp(`^${PHONE_PATTERN}$`)
