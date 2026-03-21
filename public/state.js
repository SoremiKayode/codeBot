export const appState = {
  route: 'home',
  user: null,
  poller: null,
};

export function setUser(user) {
  appState.user = user || null;
  document.body.classList.toggle('is-authenticated', Boolean(appState.user));
}

export function setRoute(route) {
  appState.route = route;
}

export function stopPoller() {
  if (appState.poller) {
    clearInterval(appState.poller);
    appState.poller = null;
  }
}
