export const routes = {
  overview: '/',
  board: '/board',
  receive: '/receive',
  dispatch: '/dispatch',
  pending: '/pending',
  exceptions: '/exceptions',
  reports: '/reports',
  ai: '/ai',
  returns: '/returns',
  sync: '/sync',
  /** The phone scanner, opened from the QR code on a laptop screen. */
  phone: '/phone/:sessionId',
} as const;
