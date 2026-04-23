/** Common runtime config used by every workspace (shell / agenticdm / lacare). */
export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}
