import { HostSession, ClientSession } from './session.js';
import { findHost, hostLobby, joinHost, newId } from './lobby.js';
import { Renderer, playerColor } from './render.js';
import { unlockAudio, playEvent, setMuted, isMuted } from './sound.js';

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => el.classList.toggle('hidden', !on);

const CONNECT_TIMEOUT_MS = 25000;

const renderer = new Renderer($('stage'));
let session = null;
let lobby = null;
let running = false;
let inGame = false;
let joining = false;
let connectTimer = null;
let lastSignature = '';

// ---- Menu / lobby flow ----

const savedName = localStorage.getItem('spacepong.name');
if (savedName) $('name').value = savedName;
const playerName = () => {
  const n = $('name').value.trim();
  localStorage.setItem('spacepong.name', n);
  return n;
};

const setStatus = (text, error = false) => {
  const el = $('menu-status');
  el.className = error ? 'status error' : 'status';
  el.textContent = text;
};

function abortToMenu(message) {
  clearTimeout(connectTimer);
  session?.close();
  session = null;
  setStatus(message, true);
  $('btn-play').disabled = false;
  joining = false;
}

function enterGame(role) {
  inGame = true;
  joining = false;
  show($('menu'), false);
  show($('hud'));
  $('role').textContent = role;
  startLoop();
}

$('btn-play').onclick = async () => {
  if (joining) return;
  unlockAudio();
  const name = playerName();
  joining = true;
  $('btn-play').disabled = true;
  try {
    const host = await findHost();
    if (host) await joinGame(name, host);
    else await hostGame(name);
  } catch (err) {
    abortToMenu(err.message);
  }
};

async function hostGame(name) {
  setStatus('No match found. Starting one…');
  session = new HostSession(name, { onEvent: playEvent, onPeer });
  lobby = await hostLobby({
    id: newId(),
    name: name || 'Host',
    onOffer: (sdp) => session.acceptOffer(sdp),
  });
  enterGame('Hosting. Waiting for players to join.');
}

async function joinGame(name, host) {
  setStatus(`Joining ${host.name || 'the match'}…`);
  session = new ClientSession(name, {
    onEvent: playEvent,
    onJoined: () => {
      clearTimeout(connectTimer);
      enterGame(`Joined ${host.name || 'the match'}`);
    },
    onClosed: (reason) => (inGame ? endGame('Disconnected', reason) : abortToMenu(reason)),
  });
  const answer = await joinHost({
    hostId: host.id,
    playerId: newId(),
    makeOffer: () => session.createOffer(),
  });
  await session.acceptAnswer(answer);
  setStatus('Connecting…');
  connectTimer = setTimeout(
    () => abortToMenu('Could not connect directly to the host. Try Play again.'),
    CONNECT_TIMEOUT_MS,
  );
}

window.addEventListener('pagehide', () => lobby?.close());

// ---- Peer notices (host) ----

function onPeer(peer) {
  if (peer.status === 'connected') toast(`${peer.name} joined`);
  else if (peer.status === 'closed' && peer.name) toast(`${peer.name} left`);
}

// ---- Input ----

const held = new Set();
const KEYS = { ArrowLeft: -1, a: -1, A: -1, ArrowRight: 1, d: 1, D: 1 };

function updateInput() {
  let dir = 0;
  for (const k of held) dir += KEYS[k];
  session?.setInput(Math.sign(dir));
}

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'm' || e.key === 'M') return toggleMute();
  if (!(e.key in KEYS)) return;
  e.preventDefault();
  held.add(e.key);
  updateInput();
});
window.addEventListener('keyup', (e) => {
  if (held.delete(e.key)) updateInput();
});
window.addEventListener('blur', () => {
  held.clear();
  updateInput();
});

$('btn-mute').onclick = toggleMute;
function toggleMute() {
  setMuted(!isMuted());
  $('btn-mute').textContent = isMuted() ? 'Sound off' : 'Sound on';
}

// ---- Loop / HUD ----

function startLoop() {
  if (running) return;
  running = true;
  let last = performance.now();
  const frame = (now) => {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    session.tick(dt);
    renderer.render(session.state, session.myId, now / 1000);
    updateScores();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function updateScores() {
  const players = session.state.players;
  const signature = players.map((p) => `${p.id}|${p.name}|${p.lost}`).join(';') + `@${session.myId}`;
  if (signature === lastSignature) return;
  lastSignature = signature;
  const list = $('score-list');
  list.replaceChildren(
    ...players.map((p) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = playerColor(p.id);
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = p.name + (p.id === session.myId ? ' (you)' : '');
      const pts = document.createElement('span');
      pts.className = 'pts';
      pts.textContent = p.lost;
      li.append(dot, nm, pts);
      return li;
    }),
  );
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  show(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show(el, false), 2500);
}

function endGame(title, text) {
  running = false;
  show($('hud'), false);
  $('overlay-title').textContent = title;
  $('overlay-text').textContent = text;
  show($('overlay'));
}

$('btn-reload').onclick = () => location.reload();
