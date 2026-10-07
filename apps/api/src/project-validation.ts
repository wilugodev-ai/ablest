import { BadRequestException } from '@nestjs/common';
type Row=Record<string,unknown>;
export function text(body: Row, key: string, max: number, required = false) {
  if (typeof body[key] !== 'string' || (body[key] as string).length > max) throw new BadRequestException(`Invalid ${key}.`);
  const value = (body[key] as string).trim();
  if (required && !value) throw new BadRequestException(`${key} is required.`);
  return value;
}
export function projectInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Invalid project.');
  const b = input as Row;
  const title = text(b, 'title', 100, true), subtitle = text(b, 'subtitle', 150), category = text(b, 'category', 100, true), description = text(b, 'description', 2000, true), url = text(b, 'url', 500);
  if (url) { let parsed; try { parsed = new URL(url); } catch { throw new BadRequestException('Use a complete project URL.'); } if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new BadRequestException('Use an http or https URL without credentials.'); }
  if (!['In development', 'Available', 'Coming soon'].includes(String(b.status))) throw new BadRequestException('Choose a valid status.');
  if (typeof b.published !== 'boolean') throw new BadRequestException('Invalid publication choice.');
  if (!Array.isArray(b.features) || b.features.length > 8 || b.features.some(f => typeof f !== 'string' || !f.trim() || f.length > 200)) throw new BadRequestException('Use up to 8 features, 200 characters each.');
  return [title, subtitle, category, description, JSON.stringify(b.features.map(f => f.trim())), String(b.status), url, Number(b.published)];
}
