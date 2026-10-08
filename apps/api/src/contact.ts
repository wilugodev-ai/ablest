import {
  BadRequestException, Body, Controller, ForbiddenException, Headers,
  HttpCode, HttpException, Logger, OnModuleDestroy, Post, Res, ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ContactLimiter } from './contact-limiter';

const services = new Set(['Custom software', 'InTouch CRM', 'IterateView', 'Surveillance solutions', 'Something else']);
const emailPattern = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unavailable = 'The contact form is temporarily unavailable. Please email ablestdigitalsolutions@gmail.com directly.';
type Reply = { setHeader(name: string, value: string): void };

function field(body: Record<string, unknown>, key: string, max: number, required = true) {
  const value = body[key];
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new BadRequestException(`Please check your ${key}.`);
  }
  return value.trim();
}

function inquiry(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid inquiry.');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['name', 'email', 'service', 'message', 'website', 'requestId'].includes(key))) {
    throw new BadRequestException('Unsupported inquiry field.');
  }
  const name = field(input, 'name', 100);
  const email = field(input, 'email', 200).toLowerCase();
  const service = field(input, 'service', 50);
  const message = field(input, 'message', 4000).replace(/\r\n?/g, '\n');
  const website = field(input, 'website', 200, false);
  const requestId = field(input, 'requestId', 36).toLowerCase();
  if (!emailPattern.test(email)) throw new BadRequestException('Enter a valid email address.');
  if (!services.has(service)) throw new BadRequestException('Choose a service from the list.');
  if (/[\r\n\x00-\x1f\x7f]/.test(name) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message)) {
    throw new BadRequestException('Please remove unsupported characters from your inquiry.');
  }
  if (website || !uuidPattern.test(requestId)) throw new BadRequestException('Please refresh the page and try again.');
  return { name, email, service, message, requestId };
}

function configuration() {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.CONTACT_FROM_EMAIL?.trim();
  const to = process.env.CONTACT_TO_EMAIL?.trim() || 'ablestdigitalsolutions@gmail.com';
  if (!key || !from || from.length > 200 || !emailPattern.test(from) || to.length > 200 || !emailPattern.test(to)) {
    throw new ServiceUnavailableException(unavailable);
  }
  return { key, from, to };
}

@Controller('v1')
export class ContactController implements OnModuleDestroy {
  private readonly limiter = new ContactLimiter();
  private readonly logger = new Logger('Contact');
  async onModuleDestroy() { await this.limiter.close(); }

  @Post('contact')
  @HttpCode(200)
  async send(@Body() body: unknown, @Headers('origin') origin: string, @Res({ passthrough: true }) response: Reply) {
    response.setHeader('Cache-Control', 'no-store');
    const allowed = process.env.WEB_ORIGIN ? [process.env.WEB_ORIGIN] : ['http://127.0.0.1:3200', 'http://localhost:3200'];
    if (!origin || !allowed.includes(origin)) throw new ForbiddenException('This request must come from the website.');
    const details = inquiry(body);
    const config = configuration();
    let permitted: boolean;
    try { permitted = await this.limiter.check(details.email); }
    catch { throw new ServiceUnavailableException(unavailable); }
    if (!permitted) {
      response.setHeader('Retry-After', '900');
      throw new HttpException('Too many inquiries. Please wait 15 minutes or email ablestdigitalsolutions@gmail.com directly.', 429);
    }
    const payload = {
      from: `Ablests Digital Solution <${config.from}>`,
      to: [config.to],
      reply_to: details.email,
      subject: `Ablests inquiry: ${details.service}`,
      text: `New website inquiry\n\nName: ${details.name}\nEmail: ${details.email}\nInterest: ${details.service}\n\n${details.message}`,
    };
    const serialized = JSON.stringify(payload);
    const fingerprint = createHash('sha256').update(serialized).digest('hex');
    let provider: Response;
    let result: unknown;
    try {
      provider = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.key}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `ablest-contact/${details.requestId}/${fingerprint}`,
        },
        body: serialized,
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      result = await provider.json();
    } catch {
      this.logger.warn('Email provider did not return a valid response.');
      throw new ServiceUnavailableException('We could not confirm your inquiry was sent. Please retry without changing the form, or email ablestdigitalsolutions@gmail.com directly.');
    }
    if (!provider.ok || !result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string' || !result.id.trim()) {
      this.logger.warn(`Email provider rejected or could not confirm the request (HTTP ${provider.status}).`);
      throw new ServiceUnavailableException(unavailable);
    }
    // Acceptance is confirmed; actual inbox delivery is visible in Resend logs.
    return { accepted: true };
  }
}
