import { HostSession, ClientSession } from './session.js';
import { Renderer, playerColor } from './render.js';
import { unlockAudio, playEvent, setMuted, isMuted } from './sound.js';

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => el.classList.toggle('hidden', !on);

const renderer = new Renderer($('stage'));
let session = null;
let running = false;
let lastSignature = '';

// ---- Menu / join flow ----

const savedName = localStorage.getItem('spacepong.name');
if (savedName) $('name').value = savedName;
const playerName = () => {
  const n = $('name').value.trim();
  localStorage.setItem('spacepong.name', n);
  return n;
};

$('btn-host').onclick = () => {
  unlockAudio();
  session = new HostSession(playerName(), { onEvent: playEvent, onInvite: renderInvite });
  show($('menu'), false);
  show($('hud'));
  show($('btn-invites'));
  show($('invites'));
  startLoop();
  newInvite();
};

$('btn-join').onclick = () => {
  show($('menu'), false);
  show($('join'));
  $('offer-in').focus();
};

$('btn-join-back').onclick = () => location.reload();

$('btn-answer').onclick = async () => {
  unlockAudio();
  const status = $('join-status');
  status.className = 'status';
  status.textContent = 'Preparing answer (gathering network candidates)…';
  $('btn-answer').disabled = true;
  try {
    session = new ClientSession(playerName(), {
      onEvent: playEvent,
      onJoined: () => {
        show($('join'), false);
        show($('hud'));
        startLoop();
      },
      onClosed: (reason) => endGame('Disconnected', reason),
    });
    $('answer-out').value = await session.accept($('offer-in').value);
    show($('step-answer'));
    status.textContent = 'Send the answer code to the host. This page connects automatically once they accept it.';
  } catch (err) {
    session?.close();
    session = null;
    status.className = 'status error';
    status.textContent = err.message;
    $('btn-answer').disabled = false;
  }
};

$('btn-copy-answer').onclick = () => copy($('answer-out').value, $('btn-copy-answer'));

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const old = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => (button.textContent = old), 1200);
  } catch {
    button.textContent = 'Select the text and copy manually';
  }
}

// ---- Host invites ----

const cards = new Map();
const STATUS_TEXT = {
  preparing: 'Preparing offer…',
  waiting: 'Waiting for the player’s answer code',
  connecting: 'Connecting…',
  connected: 'Connected',
};

$('btn-new-invite').onclick = newInvite;
$('btn-invites').onclick = () => show($('invites'), $('invites').classList.contains('hidden'));

function newInvite() {
  session.createInvite().catch((err) => toast(`Could not create invite: ${err.message}`));
}

function renderInvite(inv) {
  let card = cards.get(inv.id);
  if (!card) {
    card = document.createElement('div');
    card.className = 'invite';
    card.innerHTML = `
      <header><strong></strong><span class="state"></span></header>
      <textarea class="offer" rows="3" readonly spellcheck="false" placeholder="Preparing…"></textarea>
      <div class="actions"><button class="copy">Copy offer</button><button class="cancel">Cancel</button></div>
      <textarea class="answer" rows="3" spellcheck="false" placeholder="Paste the player’s answer code here"></textarea>
      <div class="actions"><button class="connect primary">Connect</button></div>
      <div class="error"></div>`;
    card.querySelector('.copy').onclick = (e) => copy(inv.offer, e.target);
    card.querySelector('.cancel').onclick = () => session.drop(inv.id, 'cancelled');
    card.querySelector('.connect').onclick = async () => {
      const err = card.querySelector('.error');
      err.textContent = '';
      try {
        await session.acceptAnswer(inv.id, card.querySelector('.answer').value);
      } catch (e) {
        err.textContent = e.message;
      }
    };
    cards.set(inv.id, card);
    $('invite-list').prepend(card);
  }

  card.querySelector('strong').textContent = inv.name ? inv.name : `Invite #${inv.id}`;
  card.querySelector('.offer').value = inv.offer;
  const waiting = inv.status === 'waiting';
  card.querySelector('.connect').disabled = !waiting;
  card.querySelector('.answer').disabled = !waiting;
  card.querySelector('.copy').disabled = !inv.offer;
  card.classList.toggle('closed', inv.status === 'closed');
  card.querySelector('.state').textContent =
    inv.status === 'closed' ? (inv.reason === 'cancelled' ? 'Cancelled' : 'Left') : STATUS_TEXT[inv.status];

  if (inv.status === 'connected') {
    toast(`${inv.name} joined`);
    setTimeout(() => card.remove(), 1500);
    cards.delete(inv.id);
  } else if (inv.status === 'closed') {
    if (inv.reason !== 'cancelled') toast(`${inv.name || 'A player'} left`);
    setTimeout(() => card.remove(), 1500);
    cards.delete(inv.id);
  }
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
  show($('join'), false);
  $('overlay-title').textContent = title;
  $('overlay-text').textContent = text;
  show($('overlay'));
}

$('btn-reload').onclick = () => location.reload();
