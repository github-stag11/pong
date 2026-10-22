// WebRTC sessions. The host owns the simulation; clients send their paddle position and render snapshots.
// Both ends expose the same interface: state, myId, setInput(dir), tick(dt).
import {
  PADDLE_RATE, addPlayer, removePlayer, step, createState, exportRoster, applyRoster,
  encodeSnapshot, applySnapshot, clampPos,
} from './game.js';
import { encodeSignal, decodeSignal } from './signal.js';

// STUN only (no TURN relay): peers behind strict NATs/firewalls may be unable to connect.
const RTC_CONFIG = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};
const SNAPSHOT_INTERVAL = 1 / 30;
const MAX_NAME = 16;
const DISCONNECT_GRACE_MS = 10000;

const cleanName = (n, fallback) => String(n ?? '').trim().slice(0, MAX_NAME) || fallback;

function openChannels(pc) {
  // Pre-negotiated channels, so both sides can create them without waiting for ondatachannel.
  return {
    ctrl: pc.createDataChannel('ctrl', { negotiated: true, id: 0 }),
    stream: pc.createDataChannel('stream', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 }),
  };
}

function waitForIce(pc, timeoutMs = 6000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function send(channel, payload) {
  if (channel && channel.readyState === 'open') {
    try { channel.send(typeof payload === 'string' ? payload : JSON.stringify(payload)); } catch { /* peer gone */ }
  }
}

function parse(data) {
  try { return JSON.parse(data); } catch { return null; }
}

export class HostSession {
  constructor(name, hooks = {}) {
    this.hooks = hooks;
    this.state = createState();
    this.myId = 0;
    this.nextId = 1;
    this.rv = 0; // roster version
    this.seq = 0;
    this.acc = 0;
    this.invites = new Map();
    addPlayer(this.state, 0, cleanName(name, 'Host'));
  }

  setInput(dir) {
    const me = this.state.players.find((p) => p.id === this.myId);
    if (me) me.input = dir;
  }

  tick(dt) {
    const events = step(this.state, dt);
    for (const e of events) {
      this.hooks.onEvent?.(e);
      this.broadcast('ctrl', { t: 'ev', e: e.type, id: e.id });
      if (e.type === 'miss') this.sendRoster();
    }
    this.acc += dt;
    if (this.acc >= SNAPSHOT_INTERVAL) {
      this.acc %= SNAPSHOT_INTERVAL;
      this.broadcast('stream', encodeSnapshot(this.state, ++this.seq, this.rv));
    }
  }

  broadcast(channel, payload) {
    const text = JSON.stringify(payload);
    for (const inv of this.invites.values()) {
      if (inv.joined) send(inv[channel], text);
    }
  }

  sendRoster() {
    this.broadcast('ctrl', { t: 'roster', rv: this.rv, players: exportRoster(this.state) });
  }

  notify(inv) {
    this.hooks.onInvite?.(inv);
  }

  async createInvite() {
    const id = this.nextId++;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const { ctrl, stream } = openChannels(pc);
    const inv = { id, pc, ctrl, stream, status: 'preparing', offer: '', joined: false, name: '' };
    this.invites.set(id, inv);
    this.notify(inv);

    ctrl.onmessage = (ev) => {
      const msg = parse(ev.data);
      if (!msg || msg.t !== 'hello' || inv.joined || inv.status === 'closed') return;
      inv.joined = true;
      inv.name = cleanName(msg.name, `Player ${id}`);
      addPlayer(this.state, id, inv.name);
      this.rv++;
      send(ctrl, { t: 'welcome', id });
      this.sendRoster();
      inv.status = 'connected';
      this.notify(inv);
    };
    stream.onmessage = (ev) => {
      const msg = parse(ev.data);
      const p = inv.joined && msg && this.state.players.find((q) => q.id === id);
      if (p && 'p' in msg) p.pos = clampPos(msg.p);
    };
    ctrl.onclose = () => this.drop(id, 'left');

    let graceTimer = null;
    pc.onconnectionstatechange = () => {
      clearTimeout(graceTimer);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(id, 'failed');
      else if (pc.connectionState === 'disconnected') {
        graceTimer = setTimeout(() => this.drop(id, 'failed'), DISCONNECT_GRACE_MS);
      }
    };

    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc);
    inv.offer = await encodeSignal({ type: 'offer', sdp: pc.localDescription.sdp });
    inv.status = 'waiting';
    this.notify(inv);
    return inv;
  }

  async acceptAnswer(id, code) {
    const inv = this.invites.get(id);
    if (!inv || inv.status !== 'waiting') throw new Error('This invite is no longer open.');
    const desc = await decodeSignal(code);
    if (desc.type !== 'answer' || typeof desc.sdp !== 'string') {
      throw new Error('That is not an answer code. Ask the player for the code they generated.');
    }
    await inv.pc.setRemoteDescription({ type: 'answer', sdp: desc.sdp });
    inv.status = 'connecting';
    this.notify(inv);
  }

  drop(id, reason) {
    const inv = this.invites.get(id);
    if (!inv || inv.status === 'closed') return;
    const wasJoined = inv.joined;
    inv.status = 'closed';
    inv.joined = false;
    inv.reason = wasJoined ? reason : 'cancelled';
    inv.ctrl.onclose = null;
    inv.pc.onconnectionstatechange = null;
    inv.pc.close();
    if (wasJoined && removePlayer(this.state, id)) {
      this.rv++;
      this.sendRoster();
    }
    this.notify(inv);
    this.invites.delete(id);
  }

  close() {
    for (const id of [...this.invites.keys()]) this.drop(id, 'closed');
  }
}

export class ClientSession {
  constructor(name, hooks = {}) {
    this.hooks = hooks;
    this.name = cleanName(name, 'Guest');
    this.state = createState();
    this.myId = -1;
    this.rv = -1;
    this.lastSeq = 0;
    this.input = 0;
    this.sendAcc = 0;
    this.closed = false;
  }

  async accept(offerCode) {
    const desc = await decodeSignal(offerCode);
    if (desc.type !== 'offer' || typeof desc.sdp !== 'string') {
      throw new Error('That is not an offer code. Paste the code the host generated for you.');
    }
    const pc = (this.pc = new RTCPeerConnection(RTC_CONFIG));
    const { ctrl, stream } = openChannels(pc);
    this.ctrl = ctrl;
    this.stream = stream;

    ctrl.onopen = () => send(ctrl, { t: 'hello', name: this.name });
    ctrl.onmessage = (ev) => this.onCtrl(parse(ev.data));
    ctrl.onclose = () => this.end('The host closed the connection.');
    stream.onmessage = (ev) => this.onStream(parse(ev.data));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.end('Connection failed. A direct peer-to-peer link could not be established.');
      else if (pc.connectionState === 'closed') this.end('Connection closed.');
    };

    await pc.setRemoteDescription({ type: 'offer', sdp: desc.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIce(pc);
    return encodeSignal({ type: 'answer', sdp: pc.localDescription.sdp });
  }

  onCtrl(msg) {
    if (!msg) return;
    if (msg.t === 'welcome' && Number.isInteger(msg.id)) {
      this.myId = msg.id;
      this.hooks.onJoined?.();
    } else if (msg.t === 'roster' && Array.isArray(msg.players)) {
      this.rv = msg.rv;
      applyRoster(this.state, msg.players);
    } else if (msg.t === 'ev') {
      this.hooks.onEvent?.({ type: msg.e, id: msg.id });
    }
  }

  onStream(snap) {
    if (!Array.isArray(snap) || snap[0] <= this.lastSeq) return;
    this.lastSeq = snap[0];
    applySnapshot(this.state, snap, this.rv, this.myId);
  }

  setInput(dir) {
    this.input = dir;
  }

  tick(dt) {
    const me = this.state.players.find((p) => p.id === this.myId);
    if (me && this.input) me.pos = clampPos(me.pos + this.input * PADDLE_RATE * dt);

    // Dead-reckon the ball between snapshots; the host stays authoritative.
    const b = this.state.ball;
    if (this.state.serve <= 0) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    } else {
      this.state.serve = Math.max(0, this.state.serve - dt);
    }

    this.sendAcc += dt;
    if (me && this.sendAcc >= SNAPSHOT_INTERVAL) {
      this.sendAcc %= SNAPSHOT_INTERVAL;
      send(this.stream, { p: Math.round(me.pos * 10000) / 10000 });
    }
  }

  end(reason) {
    if (this.closed) return;
    this.closed = true;
    this.pc?.close();
    this.hooks.onClosed?.(reason);
  }

  close() {
    this.closed = true;
    this.pc?.close();
  }
}
