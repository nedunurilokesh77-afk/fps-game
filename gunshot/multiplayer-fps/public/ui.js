// Simple UI wiring: menu + Join Game button -> startGame(username, lobby, gameMode)

console.log('ui.js loaded');

let uiInitialized = false;

function initUI() {
  if (uiInitialized) return;

  const menu = document.getElementById('menu');
  const joinBtn = document.getElementById('joinGameBtn');
  const usernameInput = document.getElementById('username');
  const lobbyInput = document.getElementById('lobby');
  const hud = document.getElementById('hud');
  const teamIndicator = document.getElementById('team-indicator');
  const teamText = document.getElementById('team-text');

  if (!menu || !joinBtn || !usernameInput || !lobbyInput) {
    console.error('UI elements not found (menu / username / lobby / joinGameBtn).');
    return;
  }

  const handleJoin = () => {
    const username = usernameInput.value.trim() || `Player${Math.floor(Math.random() * 999)}`;
    const lobby = lobbyInput.value.trim() || 'default';
    
    // Get selected game mode
    const gameModeInput = document.querySelector('input[name="gameMode"]:checked');
    const gameMode = gameModeInput ? gameModeInput.value : 'ffa';

    console.log('Join button clicked', { username, lobby, gameMode });

    if (typeof window.startGame !== 'function') {
      console.error('startGame(...) is not defined yet.');
      return;
    }

    const started = window.startGame(username, lobby, gameMode);
    if (started === false) {
      return;
    }

    menu.classList.remove('visible');
    menu.classList.add('hidden');

    if (hud) {
      hud.classList.remove('hidden');
      hud.classList.add('visible');
    }

    // Show team indicator for TDM
    if (gameMode === 'tdm' && teamIndicator && teamText) {
      teamIndicator.classList.remove('hidden');
    }
  };

  joinBtn.type = 'button';
  joinBtn.onclick = handleJoin;

  usernameInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') handleJoin();
  });

  lobbyInput.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') handleJoin();
  });

  menu.classList.add('visible');
  menu.classList.remove('hidden');

  uiInitialized = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI, { once: true });
} else {
  initUI();
}
