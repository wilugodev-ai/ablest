# Website inquiry email

The business inbox is `ablestdigitalsolutions@gmail.com`. The website stays in English. The existing owner login is managed separately from this contact address.

## Current activation status

Direct contact-form delivery is enabled in production with `NEXT_PUBLIC_CONTACT_DELIVERY_ENABLED=true`. The owner verified `mail.ablestsolutions.com` in North Virginia (`us-east-1`) and saved the private sending API key on the Render API service on October 8, 2026. The API was redeployed with that key. The website is rebuilt with direct delivery enabled, displaying **Send inquiry** and sending inquiries to the business inbox through the API. Actual Gmail receipt still needs confirmation with an owner-submitted inquiry; automated checks do not send real email.

Render Free blocks standard outbound SMTP ports. This integration uses Resend's HTTPS API with Node's built-in fetch and adds no dependency. No mail server or mailbox purchase is required to send these inquiries to the existing Gmail inbox. Choose Resend Free and check its current sending limits before activation.

## 1. Verify the sending domain

1. Create a Resend account, preferably using the business email, and keep its Free plan.
2. Add **mail.ablestsolutions.com** under Domains. This is a sending subdomain; the website continues using www.
3. Copy the exact DNS records from Resend into Hostinger. This account uses a DKIM TXT record at `resend._domainkey.mail`, a CNAME from `rsend.mail` to `rsend.forge.mta.net`, and a CNAME from `send.mail` to `send.forge.mta.net`. The owner confirmed all three verified in Resend. Hostinger's Name field uses only the part preceding `.ablestsolutions.com`. Copy the complete account-specific DKIM value directly from Resend. Other Resend setups can use different targets/types, so follow their actual dashboard rather than substituting generic SPF/MX examples.
4. Preserve the website's `@` A and `www` CNAME records and any existing mailbox records. Do not enable Resend receiving or replace root-domain MX records for this feature.
5. Verify the domain in Resend. It must be ready to send before activation.

## 2. Configure the API service

Create an API key with **Sending access**, restricted to the verified sending domain. Enter it directly in **Render > ablest-api > Environment**. Do not paste the key into chat, commit it, or put it in a `NEXT_PUBLIC_*` variable.

| API environment variable | Value |
| --- | --- |
| `RESEND_API_KEY` | The private restricted sending key |
| `CONTACT_FROM_EMAIL` | `website@mail.ablestsolutions.com` |
| `CONTACT_TO_EMAIL` | `ablestdigitalsolutions@gmail.com` |

Redeploy `ablest-api`. These settings are independent of its existing database secret file. The sender appears as **Ablests Digital Solution**. The recipient is selected on the server, never from visitor input. Reply-To contains the validated visitor email, so replying in Gmail reaches the visitor.

Resend's default `onboarding@resend.dev` sender is restricted to the Resend account email and is not the production sender used here. Registering a domain with Resend does not create a mailbox at `website@mail.ablestsolutions.com`.

## 3. Enable the website form

Set `NEXT_PUBLIC_CONTACT_DELIVERY_ENABLED=true` on **ablest-web** and rebuild/redeploy that service after the API configuration is ready. This is a public boolean, not a secret. The button then changes from **Prepare email inquiry** to **Send inquiry**.

For local development, keep database settings separate: add the API mail settings to ignored `apps/api/.env` and the public flag to ignored `apps/web/.env.local`, then restart development servers. Local form submissions with a real key send real emails.

## Behavior and checks

- On submission, the website first waits up to 75 seconds for the API's read-only health endpoint to report ready. A pending health request can use that full budget so a normal cold start is not interrupted every eight seconds. The same readiness check covers sign-in, registration, and session checks. Only health checks are retried; the original request is forwarded once. The inquiry POST has its existing 75-second timeout and a 165-second browser deadline. If readiness expires, no inquiry is posted and the visitor can retry with their fields preserved. An uncertain response after posting is never retried automatically.
- The API requires the configured website origin, validates all fields, rejects unknown fields and honeypot submissions, and sends plain-text mail.
- Durable counters allow up to 10 validated attempts globally and 3 per sender per 15 minutes. Retries and failed provider calls count toward these limits. Sender keys use email hashes. Existing Neon/SQLite attempt tables are reused; no inquiry text is written to them. The retained legacy Supabase backend does not support this new delivery feature.
- Unchanged retries reuse a request ID and stable payload. Resend deduplicates that key for 24 hours. There are no automatic send retries. Provider errors/timeouts keep the visitor's fields and show an error, with the business email available as fallback.
- A success response means Resend accepted the email; it does not prove Gmail inbox placement. A real form submission and its Resend delivery log should be checked after activation. No real test message has been sent during automated validation.
- Email verification, password reset, and automatic confirmations to visitors are outside this contact-form feature.

Automated tests use synthetic mail credentials and stub the provider; they do not send email. For a real end-to-end check, the owner can submit the form and confirm receipt in the business inbox. If explicitly requested to send a test on the owner's behalf, use clearly labeled test content addressed only to the configured business inbox.

## Sources

- [Render Free networking limits](https://render.com/docs/free)
- [Resend pricing](https://resend.com/pricing)
- [Resend domain setup with Hostinger](https://resend.com/docs/knowledge-base/hostinger)
- [Resend sending API keys](https://resend.com/docs/create-an-api-key)
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
