// Relay between a phone scanning with its camera and the laptop screen it's
// paired with. Sessions live in memory: a restart just means pairing again.
// Each side listens with server-sent events; the phone posts codes, the
// laptop posts back what each scan turned out to be.

import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';

import { type Request, type Response, Router } from 'express';
import { z } from 'zod';

import {
  type RemoteJoinResponse,
  RemoteEvent,
  RemoteRole,
  type RemoteScanResponse,
  type RemoteSession,
  RemoteTarget,
} from '@hexabuild/shared';

import { HOUR_MS } from '../lib/time.ts';

const SESSION_TTL_MS = 12 * HOUR_MS;

// Keeps proxies from closing a quiet stream.
const HEARTBEAT_MS = 20_000;

const WEB_PORT = Number(process.env.WEB_PORT ?? 5180);

interface Session {
  id: string;
  target: RemoteTarget;
  lastSeen: number;
  listeners: Record<RemoteRole, Set<Response>>;
}

const sessions = new Map<string, Session>();

const createBody = z.object({ target: z.enum(RemoteTarget) });

const scanBody = z.object({ id: z.uuid(), code: z.string().trim().min(3).max(64) });

const resultBody = z.object({ scanId: z.uuid(), code: z.string().max(64), outcome: z.string().max(40) });

const roleQuery = z.object({ role: z.enum(RemoteRole) });

/** This computer's address on the Wi-Fi, so the phone can reach it. */
function lanAddress(): string {
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter(net => net && net.family === 'IPv4' && !net.internal)
    .map(net => net!.address);

  return candidates.find(ip => ip.startsWith('192.168.')) ?? candidates.find(ip => ip.startsWith('10.')) ?? candidates[0] ?? 'localhost';
}

function prune() {
  const cutoff = Date.now() - SESSION_TTL_MS;

  for (const [id, session] of sessions) {
    if (session.lastSeen < cutoff) {
      sessions.delete(id);
    }
  }
}

function findSession(req: Request, res: Response): Session | null {
  const session = sessions.get(String(req.params.id));

  if (!session) {
    res.status(404).json({ error: 'This scanner link has expired. Show the QR code on the laptop again.' });
    return null;
  }

  session.lastSeen = Date.now();

  return session;
}

function send(session: Session, role: RemoteRole, event: RemoteEvent, data: unknown): boolean {
  const listeners = session.listeners[role];

  for (const res of listeners) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  return listeners.size > 0;
}

export function remoteRouter() {
  const router = Router();

  router.post('/remote/sessions', (req, res) => {
    prune();

    const { target } = createBody.parse(req.body);

    const id = randomUUID();

    sessions.set(id, { id, target, lastSeen: Date.now(), listeners: { [RemoteRole.LAPTOP]: new Set(), [RemoteRole.PHONE]: new Set() } });

    const body: RemoteSession = { id, target, phoneUrl: `https://${lanAddress()}:${WEB_PORT}/phone/${id}` };

    res.status(201).json(body);
  });

  router.get('/remote/sessions/:id/events', (req, res) => {
    const session = findSession(req, res);

    if (!session) {
      return;
    }

    const { role } = roleQuery.parse(req.query);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(': connected\n\n');

    session.listeners[role].add(res);

    if (role === RemoteRole.PHONE) {
      send(session, RemoteRole.LAPTOP, RemoteEvent.PHONE_JOINED, {});
    }

    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      session.listeners[role].delete(res);
    });
  });

  router.post('/remote/sessions/:id/join', (req, res) => {
    const session = findSession(req, res);

    if (!session) {
      return;
    }

    const body: RemoteJoinResponse = { target: session.target, laptopConnected: session.listeners[RemoteRole.LAPTOP].size > 0 };

    res.json(body);
  });

  router.post('/remote/sessions/:id/scans', (req, res) => {
    const session = findSession(req, res);

    if (!session) {
      return;
    }

    const scan = scanBody.parse(req.body);

    const body: RemoteScanResponse = { delivered: send(session, RemoteRole.LAPTOP, RemoteEvent.SCAN, scan) };

    res.json(body);
  });

  router.post('/remote/sessions/:id/results', (req, res) => {
    const session = findSession(req, res);

    if (!session) {
      return;
    }

    send(session, RemoteRole.PHONE, RemoteEvent.RESULT, resultBody.parse(req.body));

    res.status(204).end();
  });

  return router;
}
