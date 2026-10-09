'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

type Props = { interest: string; onInterestChange: (interest: string) => void };
type Attempt = { fingerprint: string; requestId: string };
const fallbackMessage = 'We couldn’t confirm your inquiry was sent. Please try again or email us directly. Your details are still here.';
const deliveryEnabled = process.env.NEXT_PUBLIC_CONTACT_DELIVERY_ENABLED === 'true';

export default function ContactForm({ interest, onInterestChange }: Props) {
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const attempt = useRef<Attempt | null>(null);

  function changed() {
    attempt.current = null;
    setNotice('');
    setError('');
  }

  useEffect(() => {
    attempt.current = null;
    setNotice('');
    setError('');
  }, [interest]);

  async function sendInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!deliveryEnabled) {
      const subject = `Ablests inquiry: ${data.get('service') || ''}`;
      const body = `Name: ${data.get('name') || ''}\nEmail: ${data.get('email') || ''}\nInterest: ${data.get('service') || ''}\n\n${data.get('message') || ''}`;
      window.location.href = `mailto:ablestdigitalsolutions@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      setError('');
      setNotice('Your email app will open with your inquiry. Review it and press Send there. If it does not open, email ablestdigitalsolutions@gmail.com directly.');
      return;
    }
    const fields = {
      name: String(data.get('name') || '').trim(),
      email: String(data.get('email') || '').trim().toLowerCase(),
      service: String(data.get('service') || '').trim(),
      message: String(data.get('message') || '').trim(),
      website: String(data.get('website') || '').trim(),
    };
    pending.current = true;
    setSending(true);
    setNotice('');
    setError('');
    try {
      const fingerprint = JSON.stringify(fields);
      if (attempt.current?.fingerprint !== fingerprint) {
        attempt.current = { fingerprint, requestId: crypto.randomUUID() };
      }
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, requestId: attempt.current.requestId }),
        signal: AbortSignal.timeout(165000),
      });
      const result: unknown = await response.json();
      const body = result && typeof result === 'object' ? result as Record<string, unknown> : {};
      if (!response.ok || body.accepted !== true) {
        setError(typeof body.message === 'string' && body.message.length <= 300 ? body.message : fallbackMessage);
        return;
      }
      form.reset();
      attempt.current = null;
      setNotice('Your inquiry has been sent. We’ll reply to the email address you provided.');
    } catch {
      setError(fallbackMessage);
    } finally {
      pending.current = false;
      setSending(false);
    }
  }

  return <form className="contact-form" onSubmit={sendInquiry} onChange={changed} aria-busy={sending}>
    <fieldset disabled={sending} aria-label="Project inquiry">
      <div className="form-row">
        <label>Your name<input name="name" autoComplete="name" required maxLength={100} placeholder="Alex Morgan"/></label>
        <label>Email address<input name="email" type="email" autoComplete="email" required maxLength={200} placeholder="alex@company.com"/></label>
      </div>
      <label>I’m interested in<select name="service" value={interest} onChange={event => onInterestChange(event.target.value)}>
        <option>Custom software</option><option>InTouch CRM</option><option>IterateView</option><option>Surveillance solutions</option><option>Something else</option>
      </select></label>
      <label>Tell us about your project<textarea name="message" required maxLength={4000} rows={4} placeholder="What would you like to build or improve?"/></label>
      <div className="contact-honeypot" aria-hidden="true" inert>
        <label>Website<input name="website" autoComplete="off" tabIndex={-1} maxLength={200}/></label>
      </div>
      <button className="button" type="submit" disabled={sending}>{sending ? 'Sending…' : deliveryEnabled ? 'Send inquiry' : 'Prepare email inquiry'}</button>
    </fieldset>
    <p className="form-note" aria-live="polite">{sending ? 'Sending may take a moment. Please keep this page open.' : deliveryEnabled ? 'Your inquiry goes directly to our team. We’ll reply by email.' : 'Opens your email app. Your inquiry is sent only when you press Send there.'}</p>
    <p className="form-notice" role="status" aria-live="polite">{notice}</p>
    {error && <p className="contact-error" role="alert">{error}</p>}
    <p className="form-note">Prefer email? <a className="contact-email-link" href="mailto:ablestdigitalsolutions@gmail.com">Write to ablestdigitalsolutions@gmail.com</a>.</p>
  </form>;
}
