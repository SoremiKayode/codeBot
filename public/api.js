const state = {
  token: localStorage.getItem('wa_token') || '',
};

export function setToken(token) {
  state.token = token || '';
  if (state.token) {
    localStorage.setItem('wa_token', state.token);
  } else {
    localStorage.removeItem('wa_token');
  }
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

export const api = {
  signup: (payload) => request('/api/auth/signup', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  setTheme: (theme) => request('/api/users/theme', { method: 'PATCH', body: JSON.stringify({ theme }) }),
  providerStatus: (provider) => request(`/api/auth/providers/${provider}`),
  connectWhatsApp: () => request('/api/whatsapp/connect', { method: 'POST' }),
  whatsappStatus: () => request('/api/whatsapp/status'),
  requiredCredentials: () => request('/api/config/required-credentials'),
  createTask: (payload) => request('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  listTasks: () => request('/api/tasks'),
  generateText: (payload) => request('/api/ai/text', { method: 'POST', body: JSON.stringify(payload) }),
  generateImage: (payload) => request('/api/ai/image', { method: 'POST', body: JSON.stringify(payload) }),
  sendEnquiry: (payload) => request('/api/enquiries', { method: 'POST', body: JSON.stringify(payload) }),
};
