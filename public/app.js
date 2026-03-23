import { api, setToken } from './api.js';
import { appState, setRoute, setUser, stopPoller } from './state.js';

const views = {
  home: document.getElementById('homeView'),
  login: document.getElementById('loginView'),
  signup: document.getElementById('signupView'),
  dashboard: document.getElementById('dashboardView'),
  tasks: document.getElementById('tasksView'),
  'task-list': document.getElementById('taskListView'),
};

const ui = {
  headerUsername: document.getElementById('headerUsername'),
  headerCredits: document.getElementById('headerCredits'),
  dashboardUsername: document.getElementById('dashboardUsername'),
  dashboardEmail: document.getElementById('dashboardEmail'),
  dashboardCredits: document.getElementById('dashboardCredits'),
  dashboardTheme: document.getElementById('dashboardTheme'),
  dashboardUsernameSecondary: document.getElementById('dashboardUsernameSecondary'),
  dashboardEmailSecondary: document.getElementById('dashboardEmailSecondary'),
  dashboardCreditsSecondary: document.getElementById('dashboardCreditsSecondary'),
  dashboardThemeSecondary: document.getElementById('dashboardThemeSecondary'),
  dashboardWorkspaceName: document.getElementById('dashboardWorkspaceName'),
  dashboardWorkspaceRole: document.getElementById('dashboardWorkspaceRole'),
  workspaceHeadline: document.getElementById('workspaceHeadline'),
  workspaceDescription: document.getElementById('workspaceDescription'),
  whatsappPhone: document.getElementById('whatsappPhone'),
  logoutButton: document.getElementById('logoutButton'),
  themeToggle: document.getElementById('themeToggle'),
  menuToggle: document.getElementById('menuToggle'),
  headerNavPanel: document.getElementById('headerNavPanel'),
  loginForm: document.getElementById('loginForm'),
  signupForm: document.getElementById('signupForm'),
  enquiryForm: document.getElementById('enquiryForm'),
  taskList: document.getElementById('taskList'),
  taskListTabSummary: document.getElementById('taskListTabSummary'),
  toast: document.getElementById('toast'),
  startButton: document.getElementById('startButton'),
  createWorkspaceButton: document.getElementById('createWorkspaceButton'),
  goToTasksButton: document.getElementById('goToTasksButton'),
  connectWhatsappButton: document.getElementById('connectWhatsappButton'),
  workspaceMembersHint: document.getElementById('workspaceMembersHint'),
  workspaceMemberForm: document.getElementById('workspaceMemberForm'),
  workspaceMemberEmail: document.getElementById('workspaceMemberEmail'),
  workspaceMemberRole: document.getElementById('workspaceMemberRole'),
  workspaceMemberSubmit: document.getElementById('workspaceMemberSubmit'),
  workspaceMembersList: document.getElementById('workspaceMembersList'),
  whatsappStatusText: document.getElementById('whatsappStatusText'),
  whatsappStatusBadge: document.getElementById('whatsappStatusBadge'),
  qrWrapper: document.getElementById('qrWrapper'),
  qrCode: document.getElementById('qrCode'),
  qrHint: document.getElementById('qrHint'),
  refreshQrButton: document.getElementById('refreshQrButton'),
  loginPasswordStrength: document.getElementById('loginPasswordStrength'),
  signupPasswordStrength: document.getElementById('signupPasswordStrength'),
  taskTitle: document.getElementById('taskTitle'),
  openAiTextTabButton: document.getElementById('openAiTextTabButton'),
  openAiMediaTabButton: document.getElementById('openAiMediaTabButton'),
  messageNextButton: document.getElementById('messageNextButton'),
  audienceBackButton: document.getElementById('audienceBackButton'),
  audienceNextButton: document.getElementById('audienceNextButton'),
  scheduleBackButton: document.getElementById('scheduleBackButton'),
  mediaFileInput: document.getElementById('mediaFileInput'),
  mediaQueue: document.getElementById('mediaQueue'),
  mediaFileInputLabel: document.getElementById('mediaFileInputLabel'),
  generateMoreMediaButton: document.getElementById('generateMoreMediaButton'),
  messagePreview: document.getElementById('messagePreview'),
  messagePreviewMedia: document.getElementById('messagePreviewMedia'),
  finalPreview: document.getElementById('finalPreview'),
  finalPreviewMedia: document.getElementById('finalPreviewMedia'),
  previewMediaStrip: document.getElementById('previewMediaStrip'),
  selectedAudienceSummary: document.getElementById('selectedAudienceSummary'),
  previewFrequencyPill: document.getElementById('previewFrequencyPill'),
  aiTextPrompt: document.getElementById('aiTextPrompt'),
  aiTextStatus: document.getElementById('aiTextStatus'),
  generateTextButton: document.getElementById('generateTextButton'),
  aiImagePrompt: document.getElementById('aiImagePrompt'),
  aiImageStatus: document.getElementById('aiImageStatus'),
  generateImageButton: document.getElementById('generateImageButton'),
  regenerateImageButton: document.getElementById('regenerateImageButton'),
  approveImageButton: document.getElementById('approveImageButton'),
  groupsTable: document.getElementById('groupsTable'),
  contactsTable: document.getElementById('contactsTable'),
  groupSearch: document.getElementById('groupSearch'),
  contactSearch: document.getElementById('contactSearch'),
  groupSortButton: document.getElementById('groupSortButton'),
  contactSortButton: document.getElementById('contactSortButton'),
  selectAllGroups: document.getElementById('selectAllGroups'),
  selectAllContacts: document.getElementById('selectAllContacts'),
  groupPrevButton: document.getElementById('groupPrevButton'),
  groupNextButton: document.getElementById('groupNextButton'),
  contactPrevButton: document.getElementById('contactPrevButton'),
  contactNextButton: document.getElementById('contactNextButton'),
  groupPageInfo: document.getElementById('groupPageInfo'),
  contactPageInfo: document.getElementById('contactPageInfo'),
  taskSearchInput: document.getElementById('taskSearchInput'),
  taskSortButton: document.getElementById('taskSortButton'),
  selectAllTasks: document.getElementById('selectAllTasks'),
  pauseSelectedTasksButton: document.getElementById('pauseSelectedTasksButton'),
  deleteSelectedTasksButton: document.getElementById('deleteSelectedTasksButton'),
  taskSelectionSummary: document.getElementById('taskSelectionSummary'),
  recipientSummaryInput: document.getElementById('recipientSummaryInput'),
  startDateInput: document.getElementById('startDateInput'),
  startTimeInput: document.getElementById('startTimeInput'),
  frequencySelect: document.getElementById('frequencySelect'),
  frequencyOptions: document.getElementById('frequencyOptions'),
  scheduleSummary: document.getElementById('scheduleSummary'),
  nextRunBadge: document.getElementById('nextRunBadge'),
  scheduleTaskButton: document.getElementById('scheduleTaskButton'),
  groupDeliveryModeInputs: document.querySelectorAll('input[name="groupDeliveryMode"]'),
};

const audienceState = {
  groups: [],
  contacts: [],
  hasLoaded: false,
};

const taskBuilderState = {
  activeTab: 'message',
  quill: null,
  pendingImage: null,
  mediaQueue: [],
  selectedGroups: new Set(),
  selectedContacts: new Set(),
  groupPage: 1,
  contactPage: 1,
  groupSortAsc: true,
  contactSortAsc: true,
  pageSize: 6,
  frequency: '',
  dailyTimes: ['09:00'],
  weeklySlots: [{ day: 'Monday', time: '09:00' }],
  monthlyWeeks: [],
  monthlyDays: [],
  groupDeliveryMode: 'group',
  manualRecipients: [],
  tasks: [],
  taskSearch: '',
  taskSortDirection: 'desc',
  selectedTaskIds: new Set(),
};

const TASK_DRAFT_STORAGE_KEY = 'wa_task_builder_draft_v1';
const workspaceState = { members: [] };

function escapeHtml(value = '') {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function normalizeWhitespace(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizePhoneRecipient(value = '') {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return '';
  if (/@s\.whatsapp\.net$/i.test(trimmed) || /@g\.us$/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7 ? `${digits}@s.whatsapp.net` : trimmed;
}

function normalizeGroupRecipient(value = '') {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) return '';
  if (/@g\.us$/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return digits ? `${digits}@g.us` : trimmed;
}

function normalizeRecipientToken(value = '', type = 'contact') {
  return type === 'group' ? normalizeGroupRecipient(value) : normalizePhoneRecipient(value);
}

function splitRecipientInput(value = '') {
  return String(value).split(',').map((item) => normalizeWhitespace(item)).filter(Boolean);
}

function dedupeRecipients(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizePhoneRecipient(value).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function syncManualRecipientsFromInput() {
  taskBuilderState.manualRecipients = dedupeRecipients(splitRecipientInput(ui.recipientSummaryInput.value));
}

function getSelectedRecipientLabels() {
  const selectedGroups = getSelectedItems(audienceState.groups, taskBuilderState.selectedGroups);
  const selectedContacts = getSelectedItems(audienceState.contacts, taskBuilderState.selectedContacts);
  return [
    ...selectedGroups.map((item) => `${item.name}${taskBuilderState.groupDeliveryMode === 'members' ? ' (all members)' : ' (group chat)'}`),
    ...selectedContacts.map((item) => item.name),
  ];
}

function getCombinedRecipientTokens() {
  return dedupeRecipients([...getSelectedRecipientLabels(), ...taskBuilderState.manualRecipients]);
}

function saveTaskDraft() {
  if (!taskBuilderState.quill) return;
  const draft = {
    title: ui.taskTitle.value,
    messageHtml: extractMessageHtml(),
    mediaQueue: taskBuilderState.mediaQueue,
    selectedGroups: Array.from(taskBuilderState.selectedGroups),
    selectedContacts: Array.from(taskBuilderState.selectedContacts),
    manualRecipients: taskBuilderState.manualRecipients,
    startDate: ui.startDateInput.value,
    startTime: ui.startTimeInput.value,
    frequency: ui.frequencySelect.value,
    dailyTimes: taskBuilderState.dailyTimes,
    weeklySlots: taskBuilderState.weeklySlots,
    monthlyWeeks: taskBuilderState.monthlyWeeks,
    monthlyDays: taskBuilderState.monthlyDays,
    groupDeliveryMode: taskBuilderState.groupDeliveryMode,
  };
  localStorage.setItem(TASK_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function restoreTaskDraft() {
  const raw = localStorage.getItem(TASK_DRAFT_STORAGE_KEY);
  if (!raw || !taskBuilderState.quill) return;
  try {
    const draft = JSON.parse(raw);
    ui.taskTitle.value = draft.title || '';
    taskBuilderState.quill.root.innerHTML = draft.messageHtml || '';
    taskBuilderState.mediaQueue = Array.isArray(draft.mediaQueue) ? draft.mediaQueue : [];
    taskBuilderState.selectedGroups = new Set(Array.isArray(draft.selectedGroups) ? draft.selectedGroups : []);
    taskBuilderState.selectedContacts = new Set(Array.isArray(draft.selectedContacts) ? draft.selectedContacts : []);
    taskBuilderState.manualRecipients = dedupeRecipients(Array.isArray(draft.manualRecipients) ? draft.manualRecipients : []);
    taskBuilderState.dailyTimes = Array.isArray(draft.dailyTimes) && draft.dailyTimes.length ? draft.dailyTimes : ['09:00'];
    taskBuilderState.weeklySlots = Array.isArray(draft.weeklySlots) && draft.weeklySlots.length ? draft.weeklySlots : [{ day: 'Monday', time: '09:00' }];
    taskBuilderState.monthlyWeeks = Array.isArray(draft.monthlyWeeks) ? draft.monthlyWeeks : [];
    taskBuilderState.monthlyDays = Array.isArray(draft.monthlyDays) ? draft.monthlyDays : [];
    taskBuilderState.groupDeliveryMode = draft.groupDeliveryMode === 'members' ? 'members' : 'group';
    ui.groupDeliveryModeInputs.forEach((input) => { input.checked = input.value === taskBuilderState.groupDeliveryMode; });
    ui.startDateInput.value = draft.startDate || '';
    ui.startTimeInput.value = draft.startTime || '';
    ui.frequencySelect.value = draft.frequency || '';
  } catch (error) {
    console.warn('Unable to restore saved task draft.', error);
    localStorage.removeItem(TASK_DRAFT_STORAGE_KEY);
  }
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => ui.toast.classList.add('hidden'), 3200);
}

function closeMenu() {
  document.querySelector('.app-header')?.classList.remove('menu-open');
  ui.menuToggle?.setAttribute('aria-expanded', 'false');
}

function navigate(route) {
  const requestedRoute = ['dashboard', 'tasks', 'task-list'].includes(route) && !appState.user ? 'login' : route;
  const targetRoute = requestedRoute;
  setRoute(targetRoute);
  closeMenu();
  Object.entries(views).forEach(([key, view]) => view.classList.toggle('active', key === targetRoute));
  if (['tasks', 'task-list'].includes(targetRoute) && appState.user) {
    if (targetRoute === 'tasks') {
      loadAudience();
      renderAudienceTables();
      renderFrequencyOptions();
      updateTaskPreview();
    }
    loadTasks();
  }
}


function renderWorkspaceMembers() {
  const hasWorkspace = Boolean(appState.user?.activeTenant);
  const canManageMembers = appState.user?.permissions?.includes('members:manage');
  if (ui.workspaceMembersHint) {
    ui.workspaceMembersHint.textContent = !hasWorkspace
      ? 'Create a workspace to invite teammates and assign them a role.'
      : canManageMembers
        ? 'Everyone in this workspace uses the same shared credit balance.'
        : 'Only workspace owners and admins can add teammates or change roles.';
  }
  if (ui.workspaceMemberEmail) ui.workspaceMemberEmail.disabled = !hasWorkspace || !canManageMembers;
  if (ui.workspaceMemberRole) ui.workspaceMemberRole.disabled = !hasWorkspace || !canManageMembers;
  if (ui.workspaceMemberSubmit) ui.workspaceMemberSubmit.disabled = !hasWorkspace || !canManageMembers;

  if (!hasWorkspace) {
    ui.workspaceMembersList.innerHTML = '<div class="empty-state">No workspace yet. You can still schedule personal tasks using your own credits.</div>';
    return;
  }

  if (!workspaceState.members.length) {
    ui.workspaceMembersList.innerHTML = '<div class="empty-state">No teammates added yet.</div>';
    return;
  }

  ui.workspaceMembersList.innerHTML = workspaceState.members.map((member) => {
    const roleOptions = ['owner', 'admin', 'operator', 'viewer'].map((role) => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${role[0].toUpperCase()}${role.slice(1)}</option>`).join('');
    const roleControl = canManageMembers
      ? `<select data-member-role="${member.id}">${roleOptions}</select>`
      : `<span class="pill">${escapeHtml(member.role)}</span>`;
    return `
      <article class="info-card">
        <div class="section-heading">
          <div>
            <strong>${escapeHtml(member.user.username)}</strong>
            <p class="muted">${escapeHtml(member.user.email)}</p>
          </div>
          ${roleControl}
        </div>
      </article>`;
  }).join('');
}

async function loadWorkspaceMembers() {
  if (!appState.user?.activeTenant || !appState.user?.permissions?.includes('members:manage')) {
    workspaceState.members = [];
    renderWorkspaceMembers();
    return;
  }
  try {
    const data = await api.listWorkspaceMembers();
    workspaceState.members = Array.isArray(data.members) ? data.members : [];
  } catch (error) {
    workspaceState.members = [];
    showToast(error.message);
  }
  renderWorkspaceMembers();
}

function updateUserUI() {
  const user = appState.user;
  const workspaceName = user?.activeTenant?.name || 'Not created';
  const workspaceRole = user?.tenantRole ? user.tenantRole[0].toUpperCase() + user.tenantRole.slice(1) : 'Not assigned';
  const hasWorkspace = Boolean(user?.activeTenant);
  ui.headerUsername.textContent = user?.username || 'Guest';
  ui.headerCredits.textContent = String(user?.credits || 0);
  ui.dashboardUsername.textContent = user?.username || '-';
  ui.dashboardEmail.textContent = user?.email || '-';
  ui.dashboardCredits.textContent = String(user?.credits || 0);
  const themeLabel = user?.theme === 'dark' ? 'Dark' : 'Light';
  ui.dashboardTheme.textContent = themeLabel;
  if (ui.dashboardUsernameSecondary) ui.dashboardUsernameSecondary.textContent = user?.username || '-';
  if (ui.dashboardEmailSecondary) ui.dashboardEmailSecondary.textContent = user?.email || '-';
  if (ui.dashboardCreditsSecondary) ui.dashboardCreditsSecondary.textContent = String(user?.credits || 0);
  if (ui.dashboardThemeSecondary) ui.dashboardThemeSecondary.textContent = themeLabel;
  if (ui.dashboardWorkspaceName) ui.dashboardWorkspaceName.textContent = workspaceName;
  if (ui.dashboardWorkspaceRole) ui.dashboardWorkspaceRole.textContent = workspaceRole;
  if (ui.workspaceHeadline) ui.workspaceHeadline.textContent = hasWorkspace ? workspaceName : 'No workspace yet.';
  if (ui.workspaceDescription) ui.workspaceDescription.textContent = hasWorkspace ? `Role: ${workspaceRole}. You can now connect WhatsApp, build tasks, and add teammates to ${workspaceName}.` : 'Create a workspace when you want shared automation, WhatsApp setup, and team access.';
  if (ui.createWorkspaceButton) {
    ui.createWorkspaceButton.textContent = hasWorkspace ? 'Workspace ready' : 'Create workspace';
    ui.createWorkspaceButton.disabled = hasWorkspace;
  }
  if (ui.goToTasksButton) ui.goToTasksButton.disabled = false;
  if (ui.connectWhatsappButton) ui.connectWhatsappButton.disabled = !hasWorkspace;
  document.documentElement.dataset.theme = user?.theme || localStorage.getItem('wa_theme') || 'light';
  renderWorkspaceMembers();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('wa_theme', theme);
}

function passwordStrengthLabel(value) {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (/[A-Z]/.test(value)) score += 1;
  if (/[a-z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  if (score >= 5) return { label: 'Strong password', className: 'is-strong' };
  if (score >= 3) return { label: 'Moderate password', className: 'is-medium' };
  return { label: 'Weak password', className: 'is-weak' };
}

function updatePasswordStrength(input, output) {
  const { label, className } = passwordStrengthLabel(input.value);
  output.textContent = input.value ? label : 'Enter your password to see strength feedback.';
  output.classList.remove('is-weak', 'is-medium', 'is-strong');
  if (input.value) output.classList.add(className);
}

async function refreshUser() {
  try {
    const data = await api.me();
    setUser(data.user);
    applyTheme(data.user.theme || 'light');
    updateUserUI();
    return data.user;
  } catch {
    setToken('');
    setUser(null);
    updateUserUI();
    stopPoller();
    return null;
  }
}

function renderQrCode(qrValue) {
  ui.qrCode.innerHTML = '';
  if (!qrValue) {
    ui.qrWrapper.classList.add('empty');
    return;
  }
  ui.qrWrapper.classList.remove('empty');
  ui.qrHint.textContent = 'Scan this QR code with WhatsApp on your phone. A larger, high-contrast version is shown below.';
  new window.QRCode(ui.qrCode, {
    text: qrValue,
    width: 320,
    height: 320,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: window.QRCode.CorrectLevel.H,
  });
}

async function handleQrRefresh() {
  ui.refreshQrButton.disabled = true;
  ui.refreshQrButton.textContent = 'Refreshing…';
  try {
    await syncWhatsAppStatus();
  } finally {
    ui.refreshQrButton.disabled = false;
    ui.refreshQrButton.textContent = 'Refresh status';
  }
}

async function syncWhatsAppStatus() {
  if (!appState.user?.activeTenant) return;
  try {
    const status = await api.whatsappStatus();
    ui.whatsappStatusText.textContent = status.message || 'Waiting for update.';
    ui.whatsappStatusBadge.textContent = status.status || 'idle';
    ui.whatsappPhone.textContent = status.phoneNumber || 'Not available';
    ui.whatsappPhone.title = status.phoneNumber || 'Not available';
    if (status.qr) renderQrCode(status.qr);
    else if (status.status === 'connected') {
      ui.qrCode.innerHTML = '';
      ui.qrWrapper.classList.add('empty');
      ui.qrHint.textContent = `Connected as ${status.phoneNumber || 'your WhatsApp account'}.`;
      stopPoller();
      await refreshUser();
      await loadAudience(true);
    }
  } catch (error) {
    stopPoller();
    showToast(error.message);
  }
}

function startWhatsAppPolling() {
  stopPoller();
  appState.poller = setInterval(syncWhatsAppStatus, 3000);
}

function syncUserFromPayload(payload) {
  if (payload?.user) {
    setUser(payload.user);
    updateUserUI();
  }
}

async function handleAuthSuccess(payload, successMessage) {
  setToken(payload.token);
  setUser(payload.user);
  applyTheme(payload.user.theme || 'light');
  updateUserUI();
  navigate('dashboard');
  await syncWhatsAppStatus();
  showToast(successMessage);
}

function setTaskTab(tabName) {
  taskBuilderState.activeTab = tabName;
  document.querySelectorAll('[data-task-tab]').forEach((button) => button.classList.toggle('active', button.dataset.taskTab === tabName));
  document.querySelectorAll('[data-task-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.taskPanel === tabName));
}

function resolveTagValue(tag, baseDate = new Date()) {
  const normalized = String(tag || '').toLowerCase();
  if (normalized === 'current_time') return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(baseDate);
  if (normalized === 'current_date') return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(baseDate);

  const match = normalized.match(/^(first|last)_(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (!match) return `{${tag}}`;
  const [, position, weekdayName] = match;
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDay = weekdays.indexOf(weekdayName);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  let date;

  if (position === 'first') {
    date = new Date(year, month, 1);
    while (date.getDay() !== targetDay) date.setDate(date.getDate() + 1);
  } else {
    date = new Date(year, month + 1, 0);
    while (date.getDay() !== targetDay) date.setDate(date.getDate() - 1);
  }

  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function translateTags(text = '') {
  return text.replace(/\{([^}]+)\}/g, (_, tag) => resolveTagValue(tag));
}

function extractMessageHtml() {
  return taskBuilderState.quill ? taskBuilderState.quill.root.innerHTML : '';
}

function extractMessageText() {
  return taskBuilderState.quill ? taskBuilderState.quill.getText().trim() : '';
}

function getSelectedItems(items, selectedIds) {
  return items.filter((item) => selectedIds.has(item.id));
}

function pruneSelections() {
  const groupIds = new Set(audienceState.groups.map((item) => item.id));
  const contactIds = new Set(audienceState.contacts.map((item) => item.id));
  taskBuilderState.selectedGroups.forEach((id) => { if (!groupIds.has(id)) taskBuilderState.selectedGroups.delete(id); });
  taskBuilderState.selectedContacts.forEach((id) => { if (!contactIds.has(id)) taskBuilderState.selectedContacts.delete(id); });
}

function updateTaskPreview() {
  const translated = translateTags(extractMessageText()) || 'Your message preview appears here.';
  ui.messagePreview.textContent = translated;
  ui.finalPreview.textContent = translated;
  ui.previewFrequencyPill.textContent = taskBuilderState.frequency || 'Not scheduled';
  ui.nextRunBadge.textContent = buildScheduleLabel();

  const selectedGroups = getSelectedItems(audienceState.groups, taskBuilderState.selectedGroups);
  const selectedContacts = getSelectedItems(audienceState.contacts, taskBuilderState.selectedContacts);
  const selectedNames = getCombinedRecipientTokens();
  ui.selectedAudienceSummary.innerHTML = selectedNames.length
    ? selectedNames.map((name) => `<span class="pill">${escapeHtml(name)}</span>`).join('')
    : '<span class="muted">No audience selected yet.</span>';

  ui.recipientSummaryInput.value = selectedNames.join(', ');
  renderMediaQueue();
  ui.scheduleSummary.textContent = buildScheduleDescription();
  saveTaskDraft();
}

function renderMediaQueue() {
  const items = taskBuilderState.mediaQueue;
  ui.generateMoreMediaButton.classList.toggle('hidden', items.length === 0);
  ui.previewMediaStrip.innerHTML = items.map((item) => `<span class="pill">${escapeHtml(item.type)}</span>`).join('');
  const previewMarkup = items.map((item) => renderMediaItem(item, 'preview')).join('');
  ui.messagePreviewMedia.innerHTML = previewMarkup;
  ui.finalPreviewMedia.innerHTML = previewMarkup;
  if (!items.length) {
    ui.mediaQueue.className = 'media-queue empty-state';
    ui.mediaQueue.textContent = 'No media selected yet.';
    return;
  }
  ui.mediaQueue.className = 'media-queue';
  ui.mediaQueue.innerHTML = items.map((item, index) => `
    <article class="media-card">
      <div class="section-heading">
        <strong>${escapeHtml(item.name)}</strong>
        <span class="pill">${escapeHtml(item.type)}</span>
      </div>
      ${renderMediaItem(item)}
      <div class="media-card__actions">
        <button class="secondary-button" type="button" data-delete-media="${index}">Delete</button>
      </div>
    </article>`).join('');
}

function formatTaskDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getTaskRecipientTokens(task = {}) {
  const groups = Array.isArray(task.recipients?.groups) ? task.recipients.groups : [];
  const contacts = Array.isArray(task.recipients?.contacts) ? task.recipients.contacts : [];
  return [
    ...groups.map((item) => normalizeRecipientToken(item.id || item.name || '', 'group')).filter(Boolean),
    ...contacts.map((item) => normalizeRecipientToken(item.id || item.phone || '', 'contact')).filter(Boolean),
  ];
}

function matchesTaskSearch(task, search) {
  if (!search) return true;
  const haystack = [
    task.title,
    task.type,
    task.status,
    task.description,
    task.messageText,
    task.translatedPreview,
    ...getTaskRecipientTokens(task),
    ...(task.recipients?.groups || []).map((item) => item.name),
    ...(task.recipients?.contacts || []).map((item) => item.name || item.phone),
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(search);
}

function getFilteredTasks() {
  const search = taskBuilderState.taskSearch.trim().toLowerCase();
  return [...taskBuilderState.tasks]
    .filter((task) => matchesTaskSearch(task, search))
    .sort((a, b) => (taskBuilderState.taskSortDirection === 'asc'
      ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
}

function updateTaskSelectionSummary(visibleTasks = []) {
  const visibleIds = visibleTasks.map((task) => task._id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => taskBuilderState.selectedTaskIds.has(id));
  ui.selectAllTasks.checked = allVisibleSelected;
  ui.taskSelectionSummary.textContent = `${taskBuilderState.selectedTaskIds.size} task${taskBuilderState.selectedTaskIds.size === 1 ? '' : 's'} selected.`;
}

function buildTaskRowsMarkup(tasks = [], { selectable = true, emptyMessage = 'No tasks found. Create a task above or adjust your search filters.' } = {}) {
  if (!tasks.length) {
    return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  }

  return `
    <div class="task-table__head">
      <span></span>
      <span>Task</span>
      <span>Recipients</span>
      <span>Schedule</span>
      <span>Status</span>
      <span>Created</span>
      <span>Actions</span>
    </div>
    ${tasks.map((task) => {
      const recipientTokens = getTaskRecipientTokens(task);
      const schedule = task.schedule || {};
      const groupCount = Array.isArray(task.recipients?.groups) ? task.recipients.groups.length : 0;
      const contactCount = Array.isArray(task.recipients?.contacts) ? task.recipients.contacts.length : 0;
      return `
      <div class="task-table__row">
        ${selectable
          ? `<input class="task-table__checkbox" type="checkbox" data-select-task="${task._id}" ${taskBuilderState.selectedTaskIds.has(task._id) ? 'checked' : ''} />`
          : '<span class="task-table__checkbox task-table__checkbox--placeholder"></span>'}
        <div class="task-table__cell">
          <strong>${escapeHtml(task.title)}</strong>
          <span class="muted">${escapeHtml(task.type || 'Automation task')}</span>
          <small>${escapeHtml(task.description || 'No description provided.')}</small>
        </div>
        <div class="task-table__cell">
          <span>${groupCount} groups (${task.recipients?.groupDeliveryMode === 'members' ? 'members' : 'group chat'})</span>
          <span>${contactCount} contacts</span>
          <div class="task-recipient-list">${recipientTokens.slice(0, 3).map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join('')}${recipientTokens.length > 3 ? `<span class="pill">+${recipientTokens.length - 3} more</span>` : ''}</div>
        </div>
        <div class="task-table__cell">
          <span>${escapeHtml(schedule.frequency || 'Not set')}</span>
          <small>${escapeHtml(schedule.startDate || 'No date')} ${escapeHtml(schedule.startTime || '')}</small>
        </div>
        <div class="task-table__cell">
          <span class="task-status ${escapeHtml(task.status)}">${escapeHtml(task.status)}</span>
        </div>
        <div class="task-table__cell">
          <span>${escapeHtml(formatTaskDate(task.createdAt))}</span>
          <small>Updated ${escapeHtml(formatTaskDate(task.updatedAt))}</small>
        </div>
        <div class="task-table__actions">
          <button class="secondary-button" type="button" data-task-action="pause" data-task-id="${task._id}" ${task.status === 'paused' ? 'disabled' : ''}>Pause</button>
          <button class="secondary-button danger-button" type="button" data-task-action="delete" data-task-id="${task._id}">Delete</button>
        </div>
      </div>`;
    }).join('')}
  `;
}

function renderTasks(tasks = []) {
  updateTaskSelectionSummary(tasks);
  ui.taskList.innerHTML = buildTaskRowsMarkup(tasks);

  if (ui.taskListTabSummary) {
    const recentTasks = tasks.slice(0, 5);
    ui.taskListTabSummary.innerHTML = `
      <div class="task-list-embedded__header">
        <span class="muted">Showing ${recentTasks.length} of ${tasks.length} task${tasks.length === 1 ? '' : 's'}.</span>
      </div>
      <div class="task-table-shell">
        <div class="task-table">${buildTaskRowsMarkup(recentTasks, { selectable: false, emptyMessage: 'No saved tasks yet. Schedule a task to see it here.' })}</div>
      </div>`;
  }
}

async function loadTasks() {
  if (!appState.user?.activeTenant) {
    taskBuilderState.tasks = [];
    renderTasks([]);
    return;
  }

  if (!appState.user) return;
  try {
    const data = await api.listTasks();
    taskBuilderState.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const validIds = new Set(taskBuilderState.tasks.map((task) => task._id));
    taskBuilderState.selectedTaskIds.forEach((id) => { if (!validIds.has(id)) taskBuilderState.selectedTaskIds.delete(id); });
    renderTasks(getFilteredTasks());
  } catch (error) {
    showToast(error.message);
  }
}

async function updateTaskStatus(taskId, status) {
  try {
    await api.updateTaskStatus(taskId, status);
    await loadTasks();
    showToast(status === 'paused' ? 'Task paused successfully.' : `Task updated to ${status}.`);
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteTask(taskId) {
  try {
    await api.deleteTask(taskId);
    taskBuilderState.selectedTaskIds.delete(taskId);
    await loadTasks();
    showToast('Task deleted successfully.');
  } catch (error) {
    showToast(error.message);
  }
}

async function applyBulkTaskAction(action) {
  const taskIds = Array.from(taskBuilderState.selectedTaskIds);
  if (!taskIds.length) {
    showToast(`Select at least one task to ${action}.`);
    return;
  }
  try {
    await api.bulkTaskAction(action, taskIds);
    if (action === 'delete') taskBuilderState.selectedTaskIds.clear();
    await loadTasks();
    showToast(action === 'pause' ? 'Selected tasks paused.' : 'Selected tasks deleted.');
  } catch (error) {
    showToast(error.message);
  }
}

function sanitizeTaskRecipients(groups = [], contacts = []) {
  const normalizedGroups = groups.map((item) => ({
    ...item,
    id: normalizeRecipientToken(item.id || item.name || '', 'group'),
    name: normalizeWhitespace(item.name || item.id || 'Unnamed group'),
  })).filter((item) => item.id.endsWith('@g.us'));

  const normalizedContacts = contacts.map((item) => {
    const id = normalizeRecipientToken(item.id || item.phone || '', 'contact');
    return {
      ...item,
      id,
      phone: id.endsWith('@s.whatsapp.net') ? `+${id.split('@')[0]}` : normalizeWhitespace(item.phone || ''),
      name: normalizeWhitespace(item.name || item.phone || id),
    };
  }).filter((item) => item.id.endsWith('@s.whatsapp.net'));

  return {
    groups: dedupeRecipients(normalizedGroups.map((item) => item.id)).map((id) => normalizedGroups.find((item) => item.id === id)).filter(Boolean),
    contacts: dedupeRecipients(normalizedContacts.map((item) => item.id)).map((id) => normalizedContacts.find((item) => item.id === id)).filter(Boolean),
  };
}

function attachRouteButtons() {
  document.querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.route)));
}

function resolveAuthMode(trigger) {
  const mode = trigger?.dataset?.authMode || trigger?.closest?.('[data-auth-mode]')?.dataset?.authMode || '';
  return mode === 'signup' ? 'signup' : 'login';
}

async function handleSocialClick(provider, trigger) {
  if (provider === 'microsoft') {
    showToast('Microsoft login is still unavailable in this build.');
    return;
  }
  try {
    const data = await api.providerStatus(provider);
    if (!data.available) {
      showToast(`${data.message} Required: ${data.requiredCredentials.join(', ')}`);
      return;
    }
    const authMode = resolveAuthMode(trigger);
    window.location.assign(api.socialAuthUrl(provider, authMode));
  } catch (error) {
    showToast(error.message);
  }
}

function handleOAuthCodeRedirect() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if ((!code || !state) && !error) return false;

  const callbackUrl = new URL('/api/auth/oauth/callback', window.location.origin);
  if (code) callbackUrl.searchParams.set('code', code);
  if (state) callbackUrl.searchParams.set('state', state);
  if (error) callbackUrl.searchParams.set('error', error);
  window.location.replace(callbackUrl.toString());
  return true;
}

async function handleOAuthRedirectState() {
  const url = new URL(window.location.href);
  const authStatus = url.searchParams.get('auth');
  if (!authStatus) return false;
  const provider = url.searchParams.get('provider') || 'social provider';
  const mode = url.searchParams.get('mode') || 'login';
  const message = url.searchParams.get('message') || (authStatus === 'success'
    ? `${provider} ${mode === 'signup' ? 'sign-up' : 'login'} completed successfully.`
    : 'Authentication failed.');
  url.searchParams.delete('auth');
  url.searchParams.delete('provider');
  url.searchParams.delete('mode');
  url.searchParams.delete('message');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);

  if (authStatus !== 'success') {
    showToast(message);
    return false;
  }

  const existingToken = localStorage.getItem('wa_token');
  if (existingToken) setToken(existingToken);
  const user = await refreshUser();
  if (!user) {
    showToast('Authentication succeeded, but we could not restore your session. Please try logging in again.');
    return false;
  }

  navigate('dashboard');
  await syncWhatsAppStatus();
  await loadTasks();
  showToast(message);
  return true;
}

function getFilteredData(items, search, sortAsc) {
  const query = search.trim().toLowerCase();
  return items
    .filter((item) => Object.values(item).some((value) => String(value).toLowerCase().includes(query)))
    .sort((a, b) => sortAsc ? String(a.name).localeCompare(String(b.name)) : String(b.name).localeCompare(String(a.name)));
}

function renderTable(type) {
  const items = type === 'groups' ? audienceState.groups : audienceState.contacts;
  const search = type === 'groups' ? ui.groupSearch.value : ui.contactSearch.value;
  const sortAsc = type === 'groups' ? taskBuilderState.groupSortAsc : taskBuilderState.contactSortAsc;
  const page = type === 'groups' ? taskBuilderState.groupPage : taskBuilderState.contactPage;
  const selected = type === 'groups' ? taskBuilderState.selectedGroups : taskBuilderState.selectedContacts;
  const filtered = getFilteredData(items, search, sortAsc);
  const totalPages = Math.max(1, Math.ceil(filtered.length / taskBuilderState.pageSize));
  const safePage = Math.min(page, totalPages);
  if (type === 'groups') taskBuilderState.groupPage = safePage;
  else taskBuilderState.contactPage = safePage;
  const start = (safePage - 1) * taskBuilderState.pageSize;
  const pageItems = filtered.slice(start, start + taskBuilderState.pageSize);
  const container = type === 'groups' ? ui.groupsTable : ui.contactsTable;
  const pageInfo = type === 'groups' ? ui.groupPageInfo : ui.contactPageInfo;
  const fields = type === 'groups' ? ['name', 'members', 'category'] : ['name', 'phone', 'segment'];

  if (!pageItems.length) {
    container.innerHTML = `<div class="table-empty">${audienceState.hasLoaded ? 'No matching records.' : 'Connect WhatsApp to load your live groups and contacts.'}</div>`;
  } else {
    container.innerHTML = `
      <div class="table-head"><span></span><span>Name</span><span>${type === 'groups' ? 'Members' : 'Phone'}</span><span>${type === 'groups' ? 'Category' : 'Segment'}</span></div>
      ${pageItems.map((item) => `
        <label class="table-row">
          <input type="checkbox" data-select-${type.slice(0, -1)}="${item.id}" ${selected.has(item.id) ? 'checked' : ''} />
          <span>${escapeHtml(item[fields[0]])}</span>
          <span>${escapeHtml(String(item[fields[1]]))}</span>
          <span>${escapeHtml(item[fields[2]])}</span>
        </label>
      `).join('')}
    `;
  }

  const visibleIds = filtered.map((item) => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  if (type === 'groups') ui.selectAllGroups.checked = allVisibleSelected;
  else ui.selectAllContacts.checked = allVisibleSelected;
  pageInfo.textContent = `Page ${safePage} of ${totalPages}`;
}

function renderAudienceTables() {
  pruneSelections();
  renderTable('groups');
  renderTable('contacts');
  updateTaskPreview();
}

async function loadAudience(force = false) {
  if (!appState.user?.activeTenant) {
    audienceState.groups = [];
    audienceState.contacts = [];
    audienceState.hasLoaded = false;
    renderAudienceTables();
    return;
  }

  if (!appState.user) return;
  if (audienceState.hasLoaded && !force) return;
  try {
    const data = await api.whatsappAudience();
    audienceState.groups = Array.isArray(data.groups) ? data.groups : [];
    audienceState.contacts = Array.isArray(data.contacts) ? data.contacts : [];
    audienceState.hasLoaded = true;
    renderAudienceTables();
    if (data.status !== 'connected' && !audienceState.groups.length && !audienceState.contacts.length) {
      showToast('Connect WhatsApp to load your real groups and contacts.');
    }
  } catch (error) {
    audienceState.groups = [];
    audienceState.contacts = [];
    audienceState.hasLoaded = false;
    renderAudienceTables();
    showToast(error.message);
  }
}

function addTimeField(value = '09:00') {
  taskBuilderState.dailyTimes.push(value);
  renderFrequencyOptions();
}

function buildScheduleDescription() {
  const startDate = ui.startDateInput.value || 'No date selected';
  const startTime = ui.startTimeInput.value || 'No time selected';
  if (!taskBuilderState.frequency) return 'Choose a frequency to see the exact rule summary.';
  if (taskBuilderState.frequency === 'once') return `Task will run once on ${startDate} at ${startTime}.`;
  if (taskBuilderState.frequency === 'daily') return `Task will run daily starting ${startDate} at ${taskBuilderState.dailyTimes.join(', ')}.`;
  if (taskBuilderState.frequency === 'weekly') return `Task will run weekly on ${taskBuilderState.weeklySlots.map((slot) => `${slot.day} ${slot.time}`).join(', ')} starting ${startDate}.`;
  return `Task will run monthly using weeks [${taskBuilderState.monthlyWeeks.join(', ') || 'none'}] and days [${taskBuilderState.monthlyDays.join(', ') || 'none'}] starting ${startDate} at ${startTime}.`;
}

function buildScheduleLabel() {
  return taskBuilderState.frequency ? `Next rule: ${taskBuilderState.frequency}` : 'Pending setup';
}

function renderFrequencyOptions() {
  const frequency = ui.frequencySelect.value;
  taskBuilderState.frequency = frequency;
  if (!frequency) {
    ui.frequencyOptions.innerHTML = '';
    updateTaskPreview();
    return;
  }

  if (frequency === 'once') {
    ui.frequencyOptions.innerHTML = '<div class="option-card">This task will run one time using the selected start date and start time.</div>';
  } else if (frequency === 'daily') {
    ui.frequencyOptions.innerHTML = `
      <div class="option-card">
        <strong>Daily run times</strong>
        <div class="stack-sm">${taskBuilderState.dailyTimes.map((time, index) => `<label><span>Time ${index + 1}</span><input type="time" data-daily-time="${index}" value="${time}" /></label>`).join('')}</div>
        <button id="addDailyTimeButton" class="secondary-button" type="button">Add another time</button>
      </div>`;
  } else if (frequency === 'weekly') {
    ui.frequencyOptions.innerHTML = `
      <div class="option-card">
        <strong>Weekly slots</strong>
        <div class="stack-sm">${taskBuilderState.weeklySlots.map((slot, index) => `
          <div class="hero-actions">
            <select data-weekly-day="${index}">
              ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => `<option value="${day}" ${slot.day === day ? 'selected' : ''}>${day}</option>`).join('')}
            </select>
            <input type="time" data-weekly-time="${index}" value="${slot.time}" />
          </div>`).join('')}</div>
        <button id="addWeeklySlotButton" class="secondary-button" type="button">Add day & time</button>
      </div>`;
  } else {
    const weeks = ['first week', 'second week', 'third week', 'last week'];
    ui.frequencyOptions.innerHTML = `
      <div class="option-card">
        <strong>Monthly options</strong>
        <div>
          <span class="muted">Choose one or more week positions.</span>
          <div class="chip-grid">${weeks.map((week) => `<button class="chip-toggle ${taskBuilderState.monthlyWeeks.includes(week) ? 'active' : ''}" type="button" data-month-week="${week}">${week}</button>`).join('')}</div>
        </div>
        <label>
          <span>Specific days of the month (comma separated)</span>
          <input id="monthlyDaysInput" type="text" value="${taskBuilderState.monthlyDays.join(', ')}" placeholder="1, 15, 28" />
        </label>
      </div>`;
  }
  updateTaskPreview();
}

async function handleTextGeneration() {
  const prompt = ui.aiTextPrompt.value.trim();
  if (!prompt) {
    showToast('Enter a prompt for AI text generation.');
    return;
  }
  ui.aiTextStatus.textContent = 'Generating text...';
  try {
    const data = await api.generateText({ prompt });
    syncUserFromPayload(data);
    ui.aiTextStatus.textContent = data.text;
    taskBuilderState.quill.root.innerHTML = `<p>${escapeHtml(data.text).replace(/\n/g, '<br>')}</p>`;
    setTaskTab('message');
    updateTaskPreview();
    showToast('AI message inserted into the editor.');
  } catch (error) {
    ui.aiTextStatus.textContent = /Not enough credits|account balance is insufficient/i.test(error.message) ? 'The AI provider rejected the request because its balance is insufficient. This is separate from your app credits.' : error.message;
    showToast(error.message);
  }
}

async function handleImageGeneration() {
  const prompt = ui.aiImagePrompt.value.trim();
  if (!prompt) {
    showToast('Enter a prompt for AI image generation.');
    return;
  }
  ui.aiImageStatus.textContent = 'Generating image...';
  try {
    const data = await api.generateImage({ prompt });
    syncUserFromPayload(data);
    taskBuilderState.pendingImage = {
      name: data.fileName || `AI generated image ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      type: 'image',
      dataUrl: data.imageUrl,
      source: 'ai',
      mimeType: data.mimeType || 'image/png',
      previewText: 'AI-generated image ready for WhatsApp preview.',
    };
    ui.aiImageStatus.innerHTML = `<article class="media-card"><img src="${data.imageUrl}" alt="AI generated" /></article>`;
    ui.regenerateImageButton.classList.remove('hidden');
    ui.approveImageButton.classList.remove('hidden');
    showToast('AI image generated. Approve it to add to the queue.');
  } catch (error) {
    ui.aiImageStatus.textContent = /Not enough credits|account balance is insufficient/i.test(error.message) ? 'The AI provider rejected the request because its balance is insufficient. This is separate from your app credits.' : error.message;
    showToast(error.message);
  }
}

function approvePendingImage() {
  if (!taskBuilderState.pendingImage) {
    showToast('Generate an image first.');
    return;
  }
  taskBuilderState.mediaQueue.push(taskBuilderState.pendingImage);
  taskBuilderState.pendingImage = null;
  ui.aiImageStatus.textContent = 'Generated image approved and added to the WhatsApp preview.';
  ui.regenerateImageButton.classList.add('hidden');
  ui.approveImageButton.classList.add('hidden');
  setTaskTab('message');
  updateTaskPreview();
  showToast('Image approved and added to the queue.');
}

function getReadableFileKind(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return 'document';
  if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) return 'text';
  return 'document';
}

function formatFileSize(bytes = 0) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function updateFileInputLabel(files = []) {
  const names = Array.from(files).map((file) => file.name);
  ui.mediaFileInputLabel.textContent = names.length ? names.join(', ') : 'No file selected yet.';
}

function renderMediaItem(item, mode = 'queue') {
  const meta = `${item.mimeType || 'File ready to send'} • ${item.sizeLabel || 'Unknown size'}`;
  if (item.type === 'image') return `<img src="${item.dataUrl}" alt="${escapeHtml(item.name)}" />`;
  if (item.type === 'video') return `<video src="${item.dataUrl}" controls></video>`;
  if (item.type === 'audio') return `<audio src="${item.dataUrl}" controls></audio>`;
  if (item.mimeType === 'application/pdf') {
    return `<div class="document-preview-card"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(meta)}</span><iframe src="${item.dataUrl}" title="${escapeHtml(item.name)}"></iframe></div>`;
  }
  return mode === 'preview'
    ? `<div class="preview-file-chip"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(meta)}</span><small>${escapeHtml(item.previewText || 'Document ready to send.')}</small></div>`
    : `<div class="file-card-preview"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(meta)}</span><small>${escapeHtml(item.previewText || 'Document ready to send.')}</small></div>`;
}

async function handleFileUpload(files) {
  const fileList = Array.from(files || []).filter(Boolean);
  if (!fileList.length) {
    updateFileInputLabel([]);
    return;
  }

  updateFileInputLabel(fileList);
  let addedCount = 0;

  for (const file of fileList) {
    if (file.size > 16 * 1024 * 1024) {
      showToast(`${file.name} is larger than 16MB and was skipped.`);
      continue;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Unable to read the selected file.'));
      reader.readAsDataURL(file);
    });
    const mediaType = getReadableFileKind(file);
    taskBuilderState.mediaQueue.push({
      name: file.name,
      type: mediaType,
      dataUrl,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      sizeLabel: formatFileSize(file.size),
      previewText: mediaType === 'document' ? 'Document added to queue.' : `Ready to send: ${file.name}`,
    });
    addedCount += 1;
  }

  ui.mediaFileInput.value = '';
  if (!addedCount) {
    updateTaskPreview();
    showToast('No files were added because they exceeded the 16MB limit.');
    return;
  }
  updateTaskPreview();
  showToast(addedCount === 1 ? 'File added to the queue.' : 'Files added to the queue.');
}

function buildScheduleConfig() {
  return {
    startDate: ui.startDateInput.value,
    startTime: ui.startTimeInput.value,
    frequency: ui.frequencySelect.value,
    dailyTimes: taskBuilderState.dailyTimes,
    weeklySlots: taskBuilderState.weeklySlots,
    monthlyWeeks: taskBuilderState.monthlyWeeks,
    monthlyDays: taskBuilderState.monthlyDays,
  };
}

async function scheduleTask() {
  syncManualRecipientsFromInput();
  const title = ui.taskTitle.value.trim() || 'Untitled WhatsApp task';
  const messageText = extractMessageText();
  const selectedContacts = getSelectedItems(audienceState.contacts, taskBuilderState.selectedContacts);
  const selectedGroups = getSelectedItems(audienceState.groups, taskBuilderState.selectedGroups);
  const manualRecipientValues = taskBuilderState.manualRecipients.map((value) => normalizePhoneRecipient(value));
  const manualContacts = manualRecipientValues
    .filter((value) => /@s\.whatsapp\.net$/i.test(value))
    .map((jid) => ({ id: jid, name: jid, phone: `+${jid.split('@')[0]}`, segment: 'Manual entry' }));
  const invalidManualRecipients = taskBuilderState.manualRecipients.filter((value) => {
    const normalized = normalizePhoneRecipient(value);
    return !/@s\.whatsapp\.net$/i.test(normalized) && !/@g\.us$/i.test(normalized);
  });

  if (!messageText) {
    showToast('Enter or generate a message before scheduling.');
    setTaskTab('message');
    return;
  }
  if (!selectedGroups.length && !selectedContacts.length && !manualContacts.length) {
    showToast('Select at least one group or contact, or paste a phone number.');
    setTaskTab('audience');
    return;
  }
  if (invalidManualRecipients.length) {
    showToast(`These recipients are invalid: ${invalidManualRecipients.join(', ')}`);
    return;
  }
  if (!ui.frequencySelect.value || !ui.startDateInput.value || !ui.startTimeInput.value) {
    showToast('Complete the scheduling inputs first.');
    return;
  }

  const contacts = dedupeRecipients([
    ...selectedContacts.map((item) => item.id),
    ...manualContacts.map((item) => item.id),
  ]).map((id) => selectedContacts.find((item) => item.id === id) || manualContacts.find((item) => item.id === id)).filter(Boolean);
  const normalizedRecipients = sanitizeTaskRecipients(selectedGroups, contacts);

  try {
    const payload = await api.createTask({
      title,
      type: 'WhatsApp automation',
      description: translateTags(messageText).slice(0, 240),
      messageHtml: extractMessageHtml(),
      messageText,
      translatedPreview: translateTags(messageText),
      mediaQueue: taskBuilderState.mediaQueue,
      recipients: {
        groups: normalizedRecipients.groups,
        contacts: normalizedRecipients.contacts,
        groupDeliveryMode: taskBuilderState.groupDeliveryMode,
      },
      schedule: buildScheduleConfig(),
    });
    syncUserFromPayload(payload);
    resetTaskBuilder();
    localStorage.removeItem(TASK_DRAFT_STORAGE_KEY);
    await loadTasks();
    showToast('Task scheduled successfully.');
  } catch (error) {
    showToast(error.message);
  }
}

function resetTaskBuilder() {
  ui.taskTitle.value = '';
  taskBuilderState.quill.setText('');
  taskBuilderState.mediaQueue = [];
  taskBuilderState.pendingImage = null;
  taskBuilderState.selectedGroups = new Set();
  taskBuilderState.selectedContacts = new Set();
  taskBuilderState.groupPage = 1;
  taskBuilderState.contactPage = 1;
  taskBuilderState.frequency = '';
  taskBuilderState.dailyTimes = ['09:00'];
  taskBuilderState.weeklySlots = [{ day: 'Monday', time: '09:00' }];
  taskBuilderState.monthlyWeeks = [];
  taskBuilderState.monthlyDays = [];
  taskBuilderState.groupDeliveryMode = 'group';
  taskBuilderState.manualRecipients = [];
  ui.groupDeliveryModeInputs.forEach((input) => { input.checked = input.value === 'group'; });
  ui.aiTextPrompt.value = '';
  ui.aiImagePrompt.value = '';
  ui.aiTextStatus.textContent = 'AI generated text will appear here before it is inserted into the editor.';
  ui.aiImageStatus.textContent = 'Generated image will appear here for review.';
  ui.regenerateImageButton.classList.add('hidden');
  ui.approveImageButton.classList.add('hidden');
  ui.mediaFileInput.value = '';
  updateFileInputLabel([]);
  ui.startDateInput.value = '';
  ui.startTimeInput.value = '';
  ui.frequencySelect.value = '';
  ui.frequencyOptions.innerHTML = '';
  renderAudienceTables();
  setTaskTab('message');
  updateTaskPreview();
}

function initQuill() {
  taskBuilderState.quill = new window.Quill('#messageEditor', {
    theme: 'snow',
    placeholder: 'Type or paste the WhatsApp message here...',
    modules: { toolbar: [['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['link', 'clean']] },
  });
  taskBuilderState.quill.on('text-change', updateTaskPreview);
}

ui.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = await api.login(Object.fromEntries(new FormData(event.currentTarget).entries()));
    await handleAuthSuccess(payload, 'Logged in successfully. Your browser session has been saved.');
  } catch (error) {
    showToast(error.message);
  }
});

ui.signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = await api.signup(Object.fromEntries(new FormData(event.currentTarget).entries()));
    await handleAuthSuccess(payload, 'Account created successfully. Your 150 credits are ready.');
  } catch (error) {
    showToast(error.message);
  }
});

ui.enquiryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = await api.sendEnquiry(Object.fromEntries(new FormData(event.currentTarget).entries()));
    event.currentTarget.reset();
    showToast(payload.message || 'Enquiry saved successfully.');
    window.open(payload.mailtoUrl, '_blank', 'noopener');
  } catch (error) {
    showToast(error.message);
  }
});

ui.logoutButton.addEventListener('click', async () => {
  try { await api.logout(); } catch {}
  setToken('');
  setUser(null);
  stopPoller();
  updateUserUI();
  navigate('home');
  showToast('Logged out.');
});

ui.themeToggle.addEventListener('click', async () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  if (appState.user) {
    try {
      const data = await api.setTheme(next);
      setUser(data.user);
      updateUserUI();
    } catch (error) {
      showToast(error.message);
    }
  }
  showToast(`Theme switched to ${next}.`);
});

ui.startButton.addEventListener('click', () => navigate(appState.user ? 'dashboard' : 'signup'));
ui.createWorkspaceButton?.addEventListener('click', async () => {
  if (appState.user?.activeTenant) {
    showToast('You already have an active workspace.');
    return;
  }
  const defaultName = appState.user?.username ? `${appState.user.username}'s Workspace` : 'My Workspace';
  const workspaceName = window.prompt('Choose a workspace name.', defaultName);
  if (workspaceName === null) return;
  try {
    const payload = await api.createWorkspace({ workspaceName });
    syncUserFromPayload(payload);
    await loadWorkspaceMembers();
    showToast(payload.created ? 'Workspace created successfully.' : 'Workspace already available on your account.');
  } catch (error) {
    showToast(error.message);
  }
});
ui.workspaceMemberForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!appState.user?.activeTenant) {
    showToast('Create a workspace first if you want to share credits with teammates.');
    return;
  }
  try {
    const payload = await api.addWorkspaceMember({ email: ui.workspaceMemberEmail.value.trim(), role: ui.workspaceMemberRole.value });
    workspaceState.members = Array.isArray(payload.members) ? payload.members : [];
    ui.workspaceMemberForm.reset();
    ui.workspaceMemberRole.value = 'viewer';
    renderWorkspaceMembers();
    showToast('Teammate added to the workspace.');
  } catch (error) {
    showToast(error.message);
  }
});

ui.goToTasksButton.addEventListener('click', () => navigate('tasks'));
ui.refreshQrButton?.addEventListener('click', handleQrRefresh);
ui.connectWhatsappButton.addEventListener('click', async () => {
  if (!appState.user?.activeTenant) {
    showToast('Create a workspace before connecting WhatsApp. Personal task scheduling works without one.');
    return;
  }
  try {
    const data = await api.connectWhatsApp();
    syncUserFromPayload(data);
    ui.whatsappStatusText.textContent = data.message || 'Waiting for QR code.';
    ui.whatsappStatusBadge.textContent = data.status || 'connecting';
    ui.whatsappPhone.textContent = data.phoneNumber || 'Not available';
    ui.whatsappPhone.title = data.phoneNumber || 'Not available';
    startWhatsAppPolling();
    await syncWhatsAppStatus();
    await loadAudience(true);
    showToast('WhatsApp connection started.');
  } catch (error) {
    showToast(error.message);
  }
});

ui.openAiTextTabButton.addEventListener('click', () => setTaskTab('ai-text'));
ui.openAiMediaTabButton.addEventListener('click', () => setTaskTab('ai-media'));
ui.generateMoreMediaButton.addEventListener('click', () => setTaskTab('ai-media'));
ui.messageNextButton.addEventListener('click', () => setTaskTab('audience'));
ui.audienceBackButton.addEventListener('click', () => setTaskTab('message'));
ui.audienceNextButton.addEventListener('click', () => setTaskTab('schedule'));
ui.scheduleBackButton.addEventListener('click', () => setTaskTab('audience'));
ui.generateTextButton.addEventListener('click', handleTextGeneration);
ui.generateImageButton.addEventListener('click', handleImageGeneration);
ui.regenerateImageButton.addEventListener('click', handleImageGeneration);
ui.approveImageButton.addEventListener('click', approvePendingImage);
ui.mediaFileInput.addEventListener('change', (event) => handleFileUpload(event.target.files));
ui.frequencySelect.addEventListener('change', renderFrequencyOptions);
ui.startDateInput.addEventListener('change', updateTaskPreview);
ui.startTimeInput.addEventListener('change', updateTaskPreview);
ui.scheduleTaskButton.addEventListener('click', scheduleTask);
ui.taskTitle.addEventListener('input', updateTaskPreview);
ui.taskSearchInput.addEventListener('input', (event) => {
  taskBuilderState.taskSearch = event.target.value;
  renderTasks(getFilteredTasks());
});
ui.taskSortButton.addEventListener('click', () => {
  taskBuilderState.taskSortDirection = taskBuilderState.taskSortDirection === 'desc' ? 'asc' : 'desc';
  ui.taskSortButton.textContent = `Sort: ${taskBuilderState.taskSortDirection === 'desc' ? 'Newest first' : 'Oldest first'}`;
  renderTasks(getFilteredTasks());
});
ui.selectAllTasks.addEventListener('change', () => {
  const visibleTasks = getFilteredTasks();
  visibleTasks.forEach((task) => {
    if (ui.selectAllTasks.checked) taskBuilderState.selectedTaskIds.add(task._id);
    else taskBuilderState.selectedTaskIds.delete(task._id);
  });
  renderTasks(visibleTasks);
});
ui.pauseSelectedTasksButton.addEventListener('click', () => applyBulkTaskAction('pause'));
ui.deleteSelectedTasksButton.addEventListener('click', () => applyBulkTaskAction('delete'));
ui.groupSearch.addEventListener('input', () => { taskBuilderState.groupPage = 1; renderTable('groups'); });
ui.contactSearch.addEventListener('input', () => { taskBuilderState.contactPage = 1; renderTable('contacts'); });
ui.groupSortButton.addEventListener('click', () => { taskBuilderState.groupSortAsc = !taskBuilderState.groupSortAsc; ui.groupSortButton.textContent = `Sort: ${taskBuilderState.groupSortAsc ? 'A–Z' : 'Z–A'}`; renderTable('groups'); });
ui.contactSortButton.addEventListener('click', () => { taskBuilderState.contactSortAsc = !taskBuilderState.contactSortAsc; ui.contactSortButton.textContent = `Sort: ${taskBuilderState.contactSortAsc ? 'A–Z' : 'Z–A'}`; renderTable('contacts'); });
ui.groupPrevButton.addEventListener('click', () => { taskBuilderState.groupPage = Math.max(1, taskBuilderState.groupPage - 1); renderTable('groups'); });
ui.groupNextButton.addEventListener('click', () => { taskBuilderState.groupPage += 1; renderTable('groups'); });
ui.contactPrevButton.addEventListener('click', () => { taskBuilderState.contactPage = Math.max(1, taskBuilderState.contactPage - 1); renderTable('contacts'); });
ui.contactNextButton.addEventListener('click', () => { taskBuilderState.contactPage += 1; renderTable('contacts'); });

ui.selectAllGroups.addEventListener('change', () => {
  getFilteredData(audienceState.groups, ui.groupSearch.value, taskBuilderState.groupSortAsc).forEach((item) => ui.selectAllGroups.checked ? taskBuilderState.selectedGroups.add(item.id) : taskBuilderState.selectedGroups.delete(item.id));
  renderTable('groups');
  updateTaskPreview();
});
ui.selectAllContacts.addEventListener('change', () => {
  getFilteredData(audienceState.contacts, ui.contactSearch.value, taskBuilderState.contactSortAsc).forEach((item) => ui.selectAllContacts.checked ? taskBuilderState.selectedContacts.add(item.id) : taskBuilderState.selectedContacts.delete(item.id));
  renderTable('contacts');
  updateTaskPreview();
});
ui.groupDeliveryModeInputs.forEach((input) => input.addEventListener('change', (event) => {
  taskBuilderState.groupDeliveryMode = event.target.value === 'members' ? 'members' : 'group';
  updateTaskPreview();
}));

document.addEventListener('click', (event) => {
  const tabButton = event.target.closest('[data-task-tab]');
  if (tabButton) setTaskTab(tabButton.dataset.taskTab);

  const backButton = event.target.closest('[data-task-back]');
  if (backButton) setTaskTab(backButton.dataset.taskBack);

  const deleteButton = event.target.closest('[data-delete-media]');
  if (deleteButton) {
    taskBuilderState.mediaQueue.splice(Number(deleteButton.dataset.deleteMedia), 1);
    updateTaskPreview();
  }

  const taskCheckbox = event.target.closest('[data-select-task]');
  if (taskCheckbox) {
    if (taskCheckbox.checked) taskBuilderState.selectedTaskIds.add(taskCheckbox.dataset.selectTask);
    else taskBuilderState.selectedTaskIds.delete(taskCheckbox.dataset.selectTask);
    updateTaskSelectionSummary(getFilteredTasks());
  }

  const taskActionButton = event.target.closest('[data-task-action]');
  if (taskActionButton) {
    const { taskAction, taskId } = taskActionButton.dataset;
    if (taskAction === 'pause') updateTaskStatus(taskId, 'paused');
    if (taskAction === 'delete') deleteTask(taskId);
  }

  const groupSelect = event.target.closest('[data-select-group]');
  if (groupSelect) {
    if (groupSelect.checked) taskBuilderState.selectedGroups.add(groupSelect.dataset.selectGroup);
    else taskBuilderState.selectedGroups.delete(groupSelect.dataset.selectGroup);
    updateTaskPreview();
  }

  const contactSelect = event.target.closest('[data-select-contact]');
  if (contactSelect) {
    if (contactSelect.checked) taskBuilderState.selectedContacts.add(contactSelect.dataset.selectContact);
    else taskBuilderState.selectedContacts.delete(contactSelect.dataset.selectContact);
    updateTaskPreview();
  }


  const weekChip = event.target.closest('[data-month-week]');
  if (weekChip) {
    const week = weekChip.dataset.monthWeek;
    if (taskBuilderState.monthlyWeeks.includes(week)) taskBuilderState.monthlyWeeks = taskBuilderState.monthlyWeeks.filter((item) => item !== week);
    else taskBuilderState.monthlyWeeks.push(week);
    renderFrequencyOptions();
  }

  if (event.target.id === 'addDailyTimeButton') addTimeField();
  if (event.target.id === 'addWeeklySlotButton') {
    taskBuilderState.weeklySlots.push({ day: 'Monday', time: '09:00' });
    renderFrequencyOptions();
  }
});

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-member-role]')) {
    api.updateWorkspaceMemberRole(event.target.dataset.memberRole, event.target.value)
      .then((payload) => { workspaceState.members = Array.isArray(payload.members) ? payload.members : []; renderWorkspaceMembers(); showToast('Workspace role updated.'); })
      .catch((error) => { showToast(error.message); loadWorkspaceMembers(); });
  }
});

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-daily-time]')) {
    taskBuilderState.dailyTimes[Number(event.target.dataset.dailyTime)] = event.target.value;
    updateTaskPreview();
  }
  if (event.target.matches('[data-weekly-day]')) {
    taskBuilderState.weeklySlots[Number(event.target.dataset.weeklyDay)].day = event.target.value;
    updateTaskPreview();
  }
  if (event.target.matches('[data-weekly-time]')) {
    taskBuilderState.weeklySlots[Number(event.target.dataset.weeklyTime)].time = event.target.value;
    updateTaskPreview();
  }
  if (event.target.id === 'monthlyDaysInput') {
    taskBuilderState.monthlyDays = event.target.value.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0 && value <= 31);
    updateTaskPreview();
  }
  if (event.target.id === 'recipientSummaryInput') {
    syncManualRecipientsFromInput();
    ui.selectedAudienceSummary.innerHTML = getCombinedRecipientTokens().map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join('') || '<span class="muted">No audience selected yet.</span>';
    saveTaskDraft();
  }
});

document.querySelectorAll('[data-provider]').forEach((button) => button.addEventListener('click', () => handleSocialClick(button.dataset.provider, button)));
document.querySelectorAll('[data-password-toggle]').forEach((button) => button.addEventListener('click', () => {
  const input = document.getElementById(button.dataset.passwordToggle);
  input.type = input.type === 'password' ? 'text' : 'password';
  button.textContent = input.type === 'password' ? 'Show' : 'Hide';
}));
['loginPassword', 'signupPassword'].forEach((id) => {
  const input = document.getElementById(id);
  const output = document.getElementById(`${id}Strength`);
  input.addEventListener('input', () => updatePasswordStrength(input, output));
});
document.querySelectorAll('[data-share]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  const url = encodeURIComponent(window.location.origin);
  const text = encodeURIComponent('Try CodeBot for WhatsApp automation and task management.');
  const provider = link.dataset.share;
  const targets = {
    whatsapp: `https://wa.me/?text=${text}%20${url}`,
    twitter: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    tiktok: 'https://www.tiktok.com/',
  };
  window.open(targets[provider], '_blank', 'noopener');
}));

attachRouteButtons();
ui.menuToggle?.addEventListener('click', () => {
  const header = document.querySelector('.app-header');
  const nextState = !header?.classList.contains('menu-open');
  header?.classList.toggle('menu-open', nextState);
  ui.menuToggle.setAttribute('aria-expanded', String(nextState));
});
applyTheme(localStorage.getItem('wa_theme') || 'light');
updateUserUI();
renderWorkspaceMembers();
initQuill();
restoreTaskDraft();
renderAudienceTables();
renderFrequencyOptions();
updateTaskPreview();

(async () => {
  const handedOffOAuthCode = handleOAuthCodeRedirect();
  if (handedOffOAuthCode) return;

  const handledOAuthRedirect = await handleOAuthRedirectState();
  if (handledOAuthRedirect) return;

  const existingToken = localStorage.getItem('wa_token');
  if (existingToken) setToken(existingToken);
  const user = await refreshUser();
  navigate(user ? 'dashboard' : 'home');
  if (user) {
    await syncWhatsAppStatus();
    await loadTasks();
    await loadWorkspaceMembers();
  }
})();
