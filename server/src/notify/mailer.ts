// Sends email through Microsoft Graph (GRAPH_TENANT_ID, GRAPH_CLIENT_ID,
// GRAPH_CLIENT_SECRET, or the MS_* names). Without them, nothing is sent.
//
// An app registration with the Mail.Send application permission signs
// in on its own (no user password) and sends as MAIL_FROM, a real Microsoft 365
// mailbox. Each email is kept in that mailbox's Sent Items.

import { config } from '../config.ts';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const TIMEOUT_MS = 15_000;

/** An error whose message is safe to show the warehouse (no secrets). */
export class MailError extends Error {}

const graph = config.mail.graph;

let token: { value: string; expiresAt: number } | null = null;

async function graphToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) {
    return token.value;
  }

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(graph.tenantId!)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: graph.clientId!,
      client_secret: graph.clientSecret!,
      scope: 'https://graph.microsoft.com/.default',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };

  if (!res.ok || !json.access_token) {
    // e.g. invalid_client (wrong secret), unauthorized_client: the first line of the description is enough.
    throw new MailError(`Microsoft sign-in failed: ${json.error ?? res.status} ${(json.error_description ?? '').split('\n')[0].slice(0, 160)}`.trim());
  }

  token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };

  return token.value;
}

async function sendWithGraph(email: Email): Promise<void> {
  const send = async (accessToken: string) =>
    fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mail.from)}/sendMail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        message: {
          subject: email.subject,
          body: { contentType: 'HTML', content: email.html },
          toRecipients: [{ emailAddress: { address: email.to } }],
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  let res = await send(await graphToken());

  // A token can be revoked before it expires: get a fresh one and try once more.
  if (res.status === 401) {
    token = null;
    res = await send(await graphToken());
  }

  if (res.status === 202) {
    return;
  }

  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };

  const why = `${json.error?.code ?? res.status}: ${json.error?.message ?? ''}`.slice(0, 180);

  if (res.status === 403) {
    throw new MailError(`Microsoft refused to send as ${config.mail.from} (${why}). The app needs the Mail.Send application permission, with admin consent`);
  }

  if (res.status === 404) {
    throw new MailError(`Microsoft has no mailbox ${config.mail.from} (${why}). MAIL_FROM must be a real mailbox`);
  }

  throw new MailError(`Microsoft Graph didn't send it (${why})`);
}

/** Whether Microsoft Graph is set up, so emails can be sent at all. */
export const mailReady = graph.enabled;

export async function sendEmail(email: Email): Promise<void> {
  if (!mailReady) {
    throw new MailError('Microsoft Graph is not set up: add GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET to .env');
  }

  try {
    await sendWithGraph(email);
  } catch (err) {
    throw err instanceof MailError ? err : new MailError(`couldn't send: ${(err as Error).message}`.slice(0, 200));
  }
}
