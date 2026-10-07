export type ProjectImage = { id: string; alt: string; position: number };
export type Project = { id: string; title: string; subtitle: string; category: string; description: string; features: string[]; status: string; url: string; published: boolean; position: number; images: ProjectImage[] };
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, { ...options, cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) { const error = new Error(Array.isArray(body.message) ? body.message.join(' ') : body.message || 'Something went wrong. Please try again.'); Object.assign(error, { status: response.status }); throw error; }
  return body;
}
export function json(method: string, body: unknown): RequestInit { return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
