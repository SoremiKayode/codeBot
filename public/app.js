import { api, setToken } from './api.js';
import { appState, setRoute, setUser, stopPoller } from './state.js';

const views = {
  home: document.getElementById('homeView'),
  login: document.getElementById('loginView'),
  signup: document.getElementById('signupView'),
  dashboard: document.getElementById('dashboardView'),
  tasks: document.getElementById('tasksView'),
};

const ui = {
  headerUsername: document.getElementById('headerUsername'),
  headerCredits: document.getElementById('headerCredits'),
  dashboardUsername: document.getElementById('dashboardUsername'),
  dashboardEmail: document.getElementById('dashboardEmail'),
  dashboardCredits: document.getElementById('dashboardCredits'),
  dashboardTheme: document.getElementById('dashboardTheme'),
  whatsappPhone: document.getElementById('whatsappPhone'),
  logoutButton: document.getElementById('logoutButton'),
  themeToggle: document.getElementById('themeToggle'),
  loginForm: document.getElementById('loginForm'),
  signupForm: document.getElementById('signupForm'),
  enquiryForm: document.getElementById('enquiryForm'),
  taskForm: document.getElementById('taskForm'),
  taskList: document.getElementById('taskList'),
  toast: document.getElementById('toast'),
  startButton: document.getElementById('startButton'),
  goToTasksButton: document.getElementById('goToTasksButton'),
  connectWhatsappButton: document.getElementById('connectWhatsappButton'),
  whatsappStatusText: document.getElementById('whatsappStatusText'),
  whatsappStatusBadge: document.getElementById('whatsappStatusBadge'),
  qrWrapper: document.getElementById('qrWrapper'),
  qrCode: document.getElementById('qrCode'),
  qrHint: document.getElementById('qrHint'),
  loginPasswordStrength: document.getElementById('loginPasswordStrength'),
  signupPasswordStrength: document.getElementById('signupPasswordStrength'),
};

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => ui.toast.classList.add('hidden'), 3200);
}

function navigate(route) {
  const targetRoute = ['dashboard', 'tasks'].includes(route) && !appState.user ? 'login' : route;
  setRoute(targetRoute);
  Object.entries(views).forEach(([key, view]) => {
    view.classList.toggle('active', key === targetRoute);
  });
  if (targetRoute === 'tasks' && appState.user) {
    loadTasks();
  }
}

function updateUserUI() {
  const user = appState.user;
  ui.headerUsername.textContent = user?.username || 'Guest';
  ui.headerCredits.textContent = String(user?.credits || 0);
  ui.dashboardUsername.textContent = user?.username || '-';
  ui.dashboardEmail.textContent = user?.email || '-';
  ui.dashboardCredits.textContent = String(user?.credits || 0);
  ui.dashboardTheme.textContent = user?.theme === 'dark' ? 'Dark' : 'Light';
  document.documentElement.dataset.theme = user?.theme || localStorage.getItem('wa_theme') || 'light';
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
  } catch (error) {
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
  ui.qrHint.textContent = 'Scan this QR code with your WhatsApp mobile app.';
  new window.QRCode(ui.qrCode, {
    text: qrValue,
    width: 220,
    height: 220,
  });
}

async function syncWhatsAppStatus() {
  if (!appState.user) return;
  try {
    const status = await api.whatsappStatus();
    ui.whatsappStatusText.textContent = status.message || 'Waiting for update.';
    ui.whatsappStatusBadge.textContent = status.status || 'idle';
    ui.whatsappPhone.textContent = status.phoneNumber || 'Not available';
    if (status.qr) {
      renderQrCode(status.qr);
    } else if (status.status === 'connected') {
      ui.qrCode.innerHTML = '';
      ui.qrWrapper.classList.add('empty');
      ui.qrHint.textContent = `Connected as ${status.phoneNumber || 'your WhatsApp account'}.`;
      stopPoller();
      await refreshUser();
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

async function handleAuthSuccess(payload, successMessage) {
  setToken(payload.token);
  setUser(payload.user);
  applyTheme(payload.user.theme || 'light');
  updateUserUI();
  navigate('dashboard');
  await syncWhatsAppStatus();
  showToast(successMessage);
}

function renderTasks(tasks = []) {
  if (!tasks.length) {
    ui.taskList.innerHTML = '<div class="empty-state">No tasks yet. Create your first task from the form.</div>';
    return;
  }

  ui.taskList.innerHTML = tasks.map((task) => `
    <article class="task-card">
      <div class="task-card__row">
        <div>
          <h3>${task.title}</h3>
          <p class="muted">${task.type}</p>
        </div>
        <span class="task-status ${task.status}">${task.status}</span>
      </div>
      <p class="muted">${task.description}</p>
      <p class="task-meta">Created ${new Date(task.createdAt).toLocaleDateString()}</p>
    </article>
  `).join('');
}

async function loadTasks() {
  if (!appState.user) return;
  try {
    const data = await api.listTasks();
    renderTasks(data.tasks || []);
  } catch (error) {
    showToast(error.message);
  }
}

function attachRouteButtons() {
  document.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.route));
  });
}

async function handleSocialClick(provider) {
  try {
    const data = await api.providerStatus(provider);
    showToast(`${data.message} Required: ${data.requiredCredentials.join(', ')}`);
  } catch (error) {
    showToast(error.message);
  }
}

ui.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    const payload = await api.login(Object.fromEntries(formData.entries()));
    await handleAuthSuccess(payload, 'Logged in successfully. Your browser session has been saved.');
  } catch (error) {
    showToast(error.message);
  }
});

ui.signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    const payload = await api.signup(Object.fromEntries(formData.entries()));
    await handleAuthSuccess(payload, 'Account created successfully. Your 150 credits are ready.');
  } catch (error) {
    showToast(error.message);
  }
});

ui.enquiryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    const payload = await api.sendEnquiry(Object.fromEntries(formData.entries()));
    event.currentTarget.reset();
    showToast(payload.message || 'Enquiry saved successfully.');
    window.open(payload.mailtoUrl, '_blank', 'noopener');
  } catch (error) {
    showToast(error.message);
  }
});

ui.taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    await api.createTask(Object.fromEntries(formData.entries()));
    event.currentTarget.reset();
    await loadTasks();
    showToast('Task created successfully.');
  } catch (error) {
    showToast(error.message);
  }
});

ui.logoutButton.addEventListener('click', async () => {
  try {
    await api.logout();
  } catch (_) {
    // ignore logout errors during client cleanup
  }
  setToken('');
  setUser(null);
  stopPoller();
  updateUserUI();
  navigate('home');
  showToast('Logged out.');
});

ui.themeToggle.addEventListener('click', async () => {
  const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  if (appState.user) {
    try {
      const data = await api.setTheme(next);
      setUser(data.user);
      updateUserUI();
      showToast(`Theme switched to ${next}.`);
    } catch (error) {
      showToast(error.message);
    }
  } else {
    showToast(`Theme switched to ${next}.`);
  }
});

ui.startButton.addEventListener('click', () => navigate(appState.user ? 'dashboard' : 'signup'));
ui.goToTasksButton.addEventListener('click', () => navigate('tasks'));
ui.connectWhatsappButton.addEventListener('click', async () => {
  try {
    const data = await api.connectWhatsApp();
    ui.whatsappStatusText.textContent = data.message || 'Waiting for QR code.';
    ui.whatsappStatusBadge.textContent = data.status || 'connecting';
    ui.whatsappPhone.textContent = data.phoneNumber || 'Not available';
    startWhatsAppPolling();
    await syncWhatsAppStatus();
    showToast('WhatsApp connection started.');
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelectorAll('[data-provider]').forEach((button) => {
  button.addEventListener('click', () => handleSocialClick(button.dataset.provider));
});

document.querySelectorAll('[data-password-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const nextType = input.type === 'password' ? 'text' : 'password';
    input.type = nextType;
    button.textContent = nextType === 'password' ? 'Show' : 'Hide';
  });
});

['loginPassword', 'signupPassword'].forEach((id) => {
  const input = document.getElementById(id);
  const output = document.getElementById(`${id}Strength`);
  input.addEventListener('input', () => updatePasswordStrength(input, output));
});

document.querySelectorAll('[data-share]').forEach((link) => {
  link.addEventListener('click', (event) => {
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
  });
});

attachRouteButtons();
applyTheme(localStorage.getItem('wa_theme') || 'light');
updateUserUI();

const existingToken = localStorage.getItem('wa_token');
if (existingToken) {
  setToken(existingToken);
  refreshUser().then(async (user) => {
    navigate(user ? 'dashboard' : 'home');
    if (user) {
      await syncWhatsAppStatus();
      await loadTasks();
    }
  });
} else {
  navigate('home');
}
