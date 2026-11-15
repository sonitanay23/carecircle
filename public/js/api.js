/**
 * API client. The session token is kept in sessionStorage by default, or in
 * localStorage if the person ticks "keep me signed in on this device".
 */
const KEY = 'carecircle.session';

const stores = () => [window.sessionStorage, window.localStorage];

export const session = {
  get() {
    for (const store of stores()) {
      try {
        const raw = store.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch {
        /* storage may be blocked */
      }
    }
    return null;
  },
  save(data, { remember = false } = {}) {
    this.clear();
    try {
      (remember ? window.localStorage : window.sessionStorage).setItem(KEY, JSON.stringify(data));
    } catch {
      /* fall back to memory only */
    }
    memory = data;
  },
  update(patch) {
    const current = this.get() ?? memory;
    if (!current) return;
    const remember = (() => {
      try {
        return Boolean(window.localStorage.getItem(KEY));
      } catch {
        return false;
      }
    })();
    this.save({ ...current, ...patch }, { remember });
  },
  clear() {
    memory = null;
    for (const store of stores()) {
      try {
        store.removeItem(KEY);
      } catch {
        /* ignore */
      }
    }
  },
};
let memory = null;

export class ApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {string} path e.g. '/api/doses/today'
 * @param {{ method?: string, body?: object, raw?: Blob, type?: string, as?: 'json'|'blob'|'text' }} [opts]
 */
export async function api(path, { method = 'GET', body, raw, type, as = 'json' } = {}) {
  const token = (session.get() ?? memory)?.token;
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (raw) headers['content-type'] = type ?? raw.type;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError('You seem to be offline. Please check your internet connection.', {
      status: 0,
      code: 'OFFLINE',
    });
  }

  if (res.status === 401 && token) {
    session.clear();
    window.dispatchEvent(new CustomEvent('carecircle:signed-out'));
  }
  if (!res.ok) {
    let message = 'Something went wrong. Please try again.';
    let code;
    try {
      const data = await res.json();
      message = data.error?.message ?? message;
      code = data.error?.code;
    } catch {
      /* not JSON */
    }
    throw new ApiError(message, { status: res.status, code });
  }
  if (res.status === 204) return null;
  const offline = res.headers.get('x-carecircle-offline') === '1';
  const data =
    as === 'blob' ? await res.blob() : as === 'text' ? await res.text() : await res.json();
  if (offline && data && typeof data === 'object' && !(data instanceof Blob)) data.__offline = true;
  return data;
}
