import { api, setToken } from './api.js';
import { appState, setRoute, setUser, stopPoller } from './state.js';

const views = {
  home: document.getElementById('homeView'),
  login: document.getElementById('loginView'),
  signup: document.getElementById('signupView'),
  dashboard: document.getElementById('dashboardView'),
};

const ui = {
  headerUsername: document.getElementById('headerUsername'),
  headerCredits: document.getElementById('headerCredits'),
  dashboardUsername: document.getElementById('dashboardUsername'),
  dashboardEmail: document.getElementById('dashboardEmail'),
  dashboardCredits: document.getElementById('dashboardCredits'),
  dashboardTheme: document.getElementById('dashboardTheme'),
  logoutButton: document.getElementById('logoutButton'),
  themeToggle: document.getElementById('themeToggle'),
  loginForm: document.getElementById('loginForm'),
  signupForm: document.getElementById('signupForm'),
  toast: document.getElementById('toast'),
  startButton: document.getElementById('startButton'),
  connectWhatsappButton: document.getElementById('connectWhatsappButton'),
  whatsappStatusText: document.getElementById('whatsappStatusText'),
  whatsappStatusBadge: document.getElementById('whatsappStatusBadge'),
  qrWrapper: document.getElementById('qrWrapper'),
  qrCode: document.getElementById('qrCode'),
  qrHint: document.getElementById('qrHint'),
};

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => ui.toast.classList.add('hidden'), 3200);
}

function navigate(route) {
  const targetRoute = route === 'dashboard' && !appState.user ? 'login' : route;
  setRoute(targetRoute);
  Object.entries(views).forEach(([key, view]) => {
    view.classList.toggle('active', key === targetRoute);
  });
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
  showToast(successMessage);
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
    await handleAuthSuccess(payload, 'Logged in successfully.');
  } catch (error) {
    showToast(error.message);
  }
});

ui.signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  try {
    const payload = await api.signup(Object.fromEntries(formData.entries()));
    await handleAuthSuccess(payload, 'Account created successfully.');
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

ui.startButton.addEventListener('click', () => navigate(appState.user ? 'dashboard' : 'login'));
ui.connectWhatsappButton.addEventListener('click', async () => {
  try {
    const data = await api.connectWhatsApp();
    ui.whatsappStatusText.textContent = data.message || 'Waiting for QR code.';
    ui.whatsappStatusBadge.textContent = data.status || 'connecting';
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

attachRouteButtons();
applyTheme(localStorage.getItem('wa_theme') || 'light');
updateUserUI();

const existingToken = localStorage.getItem('wa_token');
if (existingToken) {
  setToken(existingToken);
  refreshUser().then((user) => {
    navigate(user ? 'dashboard' : 'home');
    if (user) syncWhatsAppStatus();
  });
} else {
  navigate('home');
}
