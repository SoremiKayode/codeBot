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

  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
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
  socialAuthUrl: (provider, mode = 'login') => `/api/auth/oauth/${encodeURIComponent(provider)}/start?mode=${encodeURIComponent(mode)}`,
  createWorkspace: (payload) => request('/api/workspaces', { method: 'POST', body: JSON.stringify(payload) }),
  listWorkspaceMembers: () => request('/api/workspaces/members'),
  addWorkspaceMember: (payload) => request('/api/workspaces/members', { method: 'POST', body: JSON.stringify(payload) }),
  updateWorkspaceMemberRole: (membershipId, role) => request(`/api/workspaces/members/${membershipId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  connectWhatsApp: () => request('/api/whatsapp/connect', { method: 'POST' }),
  getCompanyProfile: () => request('/api/company-profile'),
  saveCompanyProfile: (payload) => request('/api/company-profile', { method: 'POST', body: JSON.stringify(payload) }),
  whatsappStatus: () => request('/api/whatsapp/status'),
  whatsappAudience: () => request('/api/whatsapp/audience'),
  requiredCredentials: () => request('/api/config/required-credentials'),
  publicConfig: () => request('/api/config/public'),
  createTask: (payload) => request('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  listTasks: () => request('/api/tasks'),
  updateTaskStatus: (taskId, status) => request(`/api/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteTask: (taskId) => request(`/api/tasks/${taskId}`, { method: 'DELETE' }),
  bulkTaskAction: (action, taskIds) => request('/api/tasks/bulk-action', { method: 'POST', body: JSON.stringify({ action, taskIds }) }),
  generateText: (payload) => request('/api/ai/text', { method: 'POST', body: JSON.stringify(payload) }),
  generateImage: (payload) => request('/api/ai/image', { method: 'POST', body: JSON.stringify(payload) }),
  initializePaystackPayment: (payload) => request('/api/payments/paystack/initialize', { method: 'POST', body: JSON.stringify(payload) }),
  verifyPaystackPayment: (payload) => request('/api/payments/paystack/verify', { method: 'POST', body: JSON.stringify(payload) }),
  sendEnquiry: (payload) => request('/api/enquiries', { method: 'POST', body: JSON.stringify(payload) }),
};
