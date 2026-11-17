/** Nombre de archivo seguro (sin caracteres prohibidos en Windows) y sin extensión. */
export function safeBaseName(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : fallback;
}
