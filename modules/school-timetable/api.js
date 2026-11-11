/** The sidecar has its own session-bound CSRF protection, separate from core. */
export const PREFIX = '/api/extensions/school-timetable';

export function createApi(signal) {
  let csrf = '';
  async function request(method, path, body, retry = true) {
    if (method !== 'GET' && !csrf) await request('GET', '/session');
    const response = await fetch(PREFIX + path, {
      method, credentials: 'same-origin', cache: 'no-store', signal,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Timetable-CSRF': csrf }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    csrf = response.headers.get('X-Timetable-CSRF') || csrf;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (retry && response.status === 403 && data.reason === 'csrf') {
        csrf = '';
        await request('GET', '/session');
        return request(method, path, body, false);
      }
      throw Object.assign(new Error(data.error || 'Timetable service unavailable'), { status: response.status, data });
    }
    return data;
  }
  return { get: (path) => request('GET', path), put: (path, body) => request('PUT', path, body) };
}
