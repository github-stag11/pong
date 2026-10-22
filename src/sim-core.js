// Authoritative match simulation. Pure: no DOM, no networking, no timers.
// Driven by sim-worker.js on the host, so the match keeps running when the host tab is in the background.
import {
  createState, addPlayer, removePlayer, step, exportRoster, encodeSnapshot, clampPos,
} from './game.js';

export const SNAPSHOT_INTERVAL = 1 / 30;
export const MAX_DT = 0.05;

export class MatchSim {
  constructor(hostId, hostName, rand = Math.random) {
    this.state = createState();
    this.rand = rand;
    this.rv = 0; // roster version: bumped whenever a player joins or leaves
    this.seq = 0; // snapshot sequence: bumped at SNAPSHOT_INTERVAL
    this.acc = 0;
    addPlayer(this.state, hostId, hostName);
  }

  addPlayer(id, name) {
    addPlayer(this.state, id, name);
    this.rv++;
  }

  removePlayer(id) {
    if (!removePlayer(this.state, id)) return false;
    this.rv++;
    return true;
  }

  setPos(id, pos) {
    const p = this.state.players.find((q) => q.id === id);
    if (p) p.pos = clampPos(pos);
  }

  setInput(id, dir) {
    const p = this.state.players.find((q) => q.id === id);
    if (p) p.input = Math.sign(Number(dir)) || 0;
  }

  // Advances by dt seconds (clamped). roster is true when lost-point counts changed.
  advance(dt) {
    const d = Math.min(MAX_DT, Math.max(0, Number(dt) || 0));
    const events = step(this.state, d, this.rand);
    this.acc += d;
    let send = false;
    if (this.acc >= SNAPSHOT_INTERVAL) {
      this.acc %= SNAPSHOT_INTERVAL;
      this.seq++;
      send = true;
    }
    return { events, roster: events.some((e) => e.type === 'miss'), send };
  }

  snapshot() {
    return encodeSnapshot(this.state, this.seq, this.rv);
  }

  roster() {
    return { rv: this.rv, players: exportRoster(this.state) };
  }
}
