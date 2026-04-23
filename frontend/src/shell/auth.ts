import axios from 'axios'
import { API_BASE } from '../config'

export interface SessionUser {
  id?: number
  username: string
  display_name: string
  role: string
  apps: string[]
}

export interface Session {
  token: string
  user: SessionUser
}

const STORAGE_KEY = 'brightcone.session.v1'

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function saveSession(s: Session) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

export function clearSession() {
  sessionStorage.removeItem(STORAGE_KEY)
}

export function authHeaders(): Record<string, string> {
  const s = loadSession()
  return s?.token ? { Authorization: `Bearer ${s.token}` } : {}
}

export async function login(username: string, password: string): Promise<Session> {
  const { data } = await axios.post(`${API_BASE}/api/auth/login`, { username, password })
  const session: Session = { token: data.token, user: data.user }
  saveSession(session)
  return session
}

export async function signup(payload: {
  username: string
  password: string
  display_name?: string
  email?: string
}): Promise<Session> {
  const { data } = await axios.post(`${API_BASE}/api/auth/signup`, payload)
  const session: Session = { token: data.token, user: data.user }
  saveSession(session)
  return session
}

export async function logout(token: string | undefined): Promise<void> {
  try {
    if (token) {
      await axios.post(`${API_BASE}/api/auth/logout`, { token })
    }
  } catch {
    /* ignore */
  } finally {
    clearSession()
  }
}

export interface AppCatalogEntry {
  id: 'agentic' | 'lacare'
  name: string
  tagline: string
  description: string
  icon: string
  route: string
  accent: string
}

export async function fetchAppCatalog(): Promise<AppCatalogEntry[]> {
  const { data } = await axios.get(`${API_BASE}/api/auth/apps`, { headers: authHeaders() })
  return data.apps as AppCatalogEntry[]
}
