// Read-only check of a Uniware account: can we log in, and what does each
// facility code allow? Prints statuses and short response bodies, never the
// password or token.
//   npm run diagnose -w server

import { config } from '../config.ts';

const SEARCH_PATH = '/services/rest/v1/oms/return/search';

const BODY_PREVIEW = 300;

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, BODY_PREVIEW);
}

for (const account of config.uniware.accounts) {
  console.log(`\n=== Account ${account.key}: ${account.baseUrl}, facility "${account.facility}"`);

  const url = new URL('/oauth/token', account.baseUrl);

  url.search = new URLSearchParams({
    grant_type: 'password',
    client_id: 'my-trusted-client',
    username: account.username,
    password: account.password,
  }).toString();

  const login = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });

  const loginBody = await login.text();

  if (!login.ok) {
    console.log(`Login: HTTP ${login.status} ${preview(loginBody)}`);
    continue;
  }

  const token = (JSON.parse(loginBody) as { access_token: string }).access_token;

  console.log('Login: OK');

  const now = new Date();

  const from = new Date(now.getTime() - 7 * 24 * 3_600_000);

  const iso = (d: Date) => d.toISOString().slice(0, 19);

  const facilities = [account.facility, ...(process.argv.slice(2))];

  for (const facility of [...new Set(facilities)]) {
    for (const withFacility of [true, false]) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `bearer ${token}` };

      if (withFacility) {
        headers.Facility = facility;
      }

      const res = await fetch(account.baseUrl + SEARCH_PATH, {
        method: 'POST',
        headers,
        body: JSON.stringify({ returnType: 'RTO', createdFrom: iso(from), createdTo: iso(now) }),
      });

      const label = withFacility ? `Facility "${facility}"` : 'no Facility header';

      console.log(`return/search, ${label}: HTTP ${res.status} ${preview(await res.text())}`);
    }
  }
}
