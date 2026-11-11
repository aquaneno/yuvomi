/** One-time migration through HTTP APIs only. Run while the legacy server still runs. */
import { pathToFileURL } from 'node:url';
import { timetableError } from '../../modules/school-timetable/model.js';
import { PREFIX } from './server.js';

export async function migrateLegacy({ legacyUrl, timetableUrl, publicOrigin, sessionCookie, transport = fetch }) {
  if (!/^(?:yuvomi|oikos)\.sid=[^;\s]+$/.test(sessionCookie || '')) throw new Error('Provide one Yuvomi administrator session cookie.');
  const legacy = new URL(legacyUrl);
  const target = new URL(timetableUrl);
  if (![legacy, target].every((url) => ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)) throw new Error('HTTP(S) URLs without credentials are required.');
  if (new URL(publicOrigin).origin !== publicOrigin) throw new Error('Provide an exact PUBLIC_ORIGIN.');
  async function request(base, path, method = 'GET', body, csrf) {
    const response = await transport(new URL(path, base), {
      method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Cookie: sessionCookie + (csrf ? `; school-timetable-csrf=${csrf}` : ''), Origin: publicOrigin,
        Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'X-Timetable-CSRF': csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`Migration stopped: ${method} ${path} returned ${response.status}.`);
    return { body: await response.json(), csrf: response.headers.get('X-Timetable-CSRF') };
  }
  const identity = (await request(legacy, '/api/v1/auth/me')).body;
  if (identity.user?.role !== 'admin' || identity.permissions?.admin !== true) throw new Error('An administrator session is required.');
  const members = (await request(legacy, '/api/v1/timetable/members')).body.data;
  if (!Array.isArray(members)) throw new Error('Legacy timetable member endpoint is unavailable.');
  const report = { copied: [], skipped: [] };
  for (const member of members) {
    if (!Number.isSafeInteger(member.id) || member.id <= 0) throw new Error('Invalid member ID.');
    const source = (await request(legacy, `/api/v1/timetable/${member.id}`)).body;
    const destination = await request(target, `${PREFIX}/${member.id}`);
    if (source.revision === 0 || destination.body.revision !== 0) { report.skipped.push(member.id); continue; }
    if (timetableError(source.data)) throw new Error(`Invalid legacy timetable for member ${member.id}.`);
    await request(target, `${PREFIX}/${member.id}`, 'PUT', { data: source.data, revision: 0 }, destination.csrf);
    report.copied.push(member.id);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await migrateLegacy({ legacyUrl: process.env.LEGACY_URL, timetableUrl: process.env.TIMETABLE_URL, publicOrigin: process.env.PUBLIC_ORIGIN, sessionCookie: process.env.YUVOMI_SESSION_COOKIE });
    console.log(`Copied ${report.copied.length} timetables; skipped ${report.skipped.length} empty or already migrated timetables.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
