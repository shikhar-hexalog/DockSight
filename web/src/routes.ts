export const routes = {
  overview: '/',
  board: '/board',
  receive: '/receive',
  qc: '/qc',
  dispatch: '/dispatch',
  pending: '/pending',
  exceptions: '/exceptions',
  reports: '/reports',
  ai: '/ai',
  returns: '/returns',
  sync: '/sync',
  roadmap: '/roadmap',
  /** The phone scanner, opened from the QR code on a laptop screen. */
  phone: '/phone/:sessionId',
} as const;
