export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(method, url, body) {
  const isForm = body instanceof FormData;
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: 'same-origin',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Network error: check your connection and try again');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && url !== '/auth/login' && url !== '/auth/me') {
      window.dispatchEvent(new Event('ajaia:unauthorized'));
    }
    throw new ApiError(res.status, data?.error?.message || `Request failed (${res.status})`, data?.error);
  }
  return data;
}

export const api = {
  me: () => request('GET', '/auth/me'),
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  logout: () => request('POST', '/auth/logout'),
  users: () => request('GET', '/users'),
  listDocs: () => request('GET', '/documents'),
  createDoc: (body = {}) => request('POST', '/documents', body),
  importDoc: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', '/documents/import', fd);
  },
  getDoc: (id) => request('GET', `/documents/${id}`),
  updateDoc: (id, body) => request('PATCH', `/documents/${id}`, body),
  deleteDoc: (id) => request('DELETE', `/documents/${id}`),
  share: (id, email, role) => request('POST', `/documents/${id}/shares`, { email, role }),
  unshare: (id, userId) => request('DELETE', `/documents/${id}/shares/${userId}`),
  versions: (id) => request('GET', `/documents/${id}/versions`),
  getVersion: (id, versionId) => request('GET', `/documents/${id}/versions/${versionId}`),
  restoreVersion: (id, versionId) => request('POST', `/documents/${id}/versions/${versionId}/restore`),
  heartbeat: (id, typing) => request('POST', `/documents/${id}/presence`, { typing }),
  leave: (id) => request('DELETE', `/documents/${id}/presence`),
};
