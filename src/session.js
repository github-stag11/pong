// WebRTC sessions. The host owns the simulation; clients send their paddle position and render snapshots.
// Both ends expose the same interface: state, myId, setInput(dir), tick(dt).
// Offers and answers are exchanged by lobby.js; these classes only deal with SDP.
import {
  PADDLE_RATE, addPlayer, createState, applyRoster, applySnapshot, clampPos,
} from './game.js';
import { SNAPSHOT_INTERVAL } from './sim-core.js';

// STUN finds public addresses; the TURN relay (Metered Open Relay) carries traffic for peers that cannot connect directly.
const STUN_SERVERS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
const TURN_CREDENTIALS_URL = 'https://gia-pong.metered.live/api/v1/turn/credentials?apiKey=da877c2e305fbc83462073cac92842a98752';
const MAX_NAME = 16;
const DISCONNECT_GRACE_MS = 10000;
const JOIN_TIMEOUT_MS = 30000;

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

// Falls back to STUN only if the TURN credentials cannot be fetched.
async function fetchIceServers() {
  try {
    const res = await fetch(TURN_CREDENTIALS_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`TURN credentials: HTTP ${res.status}`);
    const turn = await res.json();
    return [{ urls: STUN_SERVERS }, ...turn];
  } catch {
    return [{ urls: STUN_SERVERS }];
  }
}

function send(channel, payload) {
  if (channel && channel.readyState === 'open') {
    try { channel.send(typeof payload === 'string' ? payload : JSON.stringify(payload)); } catch { /* peer gone */ }
  }
}

function parse(data) {
  try { return JSON.parse(data); } catch { return null; }
}

// The match simulation runs in sim-worker.js. This class keeps the WebRTC links and a mirror of the worker's state.
export class HostSession {
  constructor(name, hooks = {}) {
    this.hooks = hooks;
    this.state = createState();
    this.myId = 0;
    this.nextId = 1;
    this.rv = 0; // roster version
    this.peers = new Map();
    const hostName = cleanName(name, 'Host');
    addPlayer(this.state, this.myId, hostName);
    this.worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => this.onSim(data);
    this.worker.onerror = (e) => {
      e.preventDefault?.();
      this.hooks.onFailure?.(e.message || 'The match simulation stopped unexpectedly.');
    };
    this.worker.postMessage({ t: 'init', id: this.myId, name: hostName });
  }

  setInput(dir) {
    this.worker.postMessage({ t: 'input', id: this.myId, dir });
  }

  // Nothing to advance here; the worker ticks on its own timer so it keeps running in background tabs.
  tick() {}

  onSim(msg) {
    if (msg.t === 'roster') {
      this.rv = msg.rv;
      applyRoster(this.state, msg.players);
      this.broadcast('ctrl', { t: 'roster', rv: this.rv, players: msg.players });
    } else if (msg.t === 'tick') {
      applySnapshot(this.state, msg.snap, this.rv, null);
      for (const e of msg.events) {
        this.hooks.onEvent?.(e);
        this.broadcast('ctrl', { t: 'ev', e: e.type, id: e.id, k: e.kind });
      }
      if (msg.send) this.broadcast('stream', msg.snap);
    }
  }

  broadcast(channel, payload) {
    const text = JSON.stringify(payload);
    for (const peer of this.peers.values()) {
      if (peer.joined) send(peer[channel], text);
    }
  }

  notify(peer) {
    this.hooks.onPeer?.(peer);
  }

  // Answers a player's offer and returns the answer SDP. The player becomes a match member once they say hello.
  async acceptOffer(sdp) {
    const id = this.nextId++;
    const pc = new RTCPeerConnection({ iceServers: await fetchIceServers() });
    const { ctrl, stream } = openChannels(pc);
    const peer = { id, pc, ctrl, stream, status: 'connecting', joined: false, name: '' };
    this.peers.set(id, peer);

    ctrl.onmessage = (ev) => {
      const msg = parse(ev.data);
      if (!msg || msg.t !== 'hello' || peer.joined || peer.status === 'closed') return;
      peer.joined = true;
      peer.name = cleanName(msg.name, `Player ${id}`);
      this.worker.postMessage({ t: 'add', id, name: peer.name });
      send(ctrl, { t: 'welcome', id });
      peer.status = 'connected';
      this.notify(peer);
    };
    stream.onmessage = (ev) => {
      const msg = parse(ev.data);
      if (peer.joined && msg && typeof msg === 'object' && 'p' in msg) {
        this.worker.postMessage({ t: 'pos', id, pos: msg.p });
      }
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
    setTimeout(() => { if (!peer.joined) this.drop(id, 'timeout'); }, JOIN_TIMEOUT_MS);

    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIce(pc);
    return pc.localDescription.sdp;
  }

  drop(id, reason) {
    const peer = this.peers.get(id);
    if (!peer || peer.status === 'closed') return;
    const wasJoined = peer.joined;
    peer.status = 'closed';
    peer.joined = false;
    peer.reason = reason;
    peer.ctrl.onclose = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    this.peers.delete(id);
    if (wasJoined) this.worker.postMessage({ t: 'remove', id });
    this.notify(peer);
  }

  close() {
    for (const id of [...this.peers.keys()]) this.drop(id, 'closed');
    this.worker.terminate();
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

  // Creates the offer SDP to send to the host. Call acceptAnswer() with the host's reply.
  async createOffer() {
    const pc = (this.pc = new RTCPeerConnection({ iceServers: await fetchIceServers() }));
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

    await pc.setLocalDescription(await pc.createOffer());
    await waitForIce(pc);
    return pc.localDescription.sdp;
  }

  async acceptAnswer(sdp) {
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
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
      this.hooks.onEvent?.({ type: msg.e, id: msg.id, kind: msg.k });
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

    // Dead-reckon the balls between snapshots; the host stays authoritative.
    if (this.state.serve <= 0) {
      for (const b of this.state.balls) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
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
