// Authoritative match simulation. Pure: no DOM, no networking, no timers.
// Driven by sim-worker.js on the host, so the match keeps running when the host tab is in the background.
import {
  createState, addPlayer, removePlayer, step, exportRoster, encodeSnapshot, clampPos,
  layout, geometry, paddleLength,
} from './game.js';
import { effectScale } from './bonus.js';

export const SNAPSHOT_INTERVAL = 1 / 30;
export const MAX_DT = 0.05;
export const BOT_ID = -1;
const BOT_DEAD_ZONE = 0.05;

export class MatchSim {
  constructor(hostId, hostName, rand = Math.random) {
    this.state = createState();
    this.rand = rand;
    this.rv = 0; // roster version: bumped whenever a player joins or leaves
    this.seq = 0; // snapshot sequence: bumped at SNAPSHOT_INTERVAL
    this.acc = 0;
    addPlayer(this.state, hostId, hostName);
    this.syncBot();
  }

  // An AI opponent plays only while the host is the sole human.
  syncBot() {
    const players = this.state.players;
    const hasBot = players.some((p) => p.id === BOT_ID);
    const humans = players.length - (hasBot ? 1 : 0);
    if (humans === 1 && !hasBot) addPlayer(this.state, BOT_ID, 'AI');
    else if (humans > 1 && hasBot) removePlayer(this.state, BOT_ID);
    else return;
    this.rv++;
  }

  addPlayer(id, name) {
    addPlayer(this.state, id, name);
    this.rv++;
    this.syncBot();
  }

  removePlayer(id) {
    if (!removePlayer(this.state, id)) return false;
    this.rv++;
    this.syncBot();
    return true;
  }

  // Steers the bot's paddle toward the nearest ball along its own side.
  steerBot() {
    const { players, balls } = this.state;
    const bot = players.find((p) => p.id === BOT_ID);
    if (!bot || balls.length === 0) {
      if (bot) bot.input = 0;
      return;
    }
    const { sides, slots } = layout(players.length);
    const g = geometry(sides)[slots[players.indexOf(bot)]];
    const along = (b) => (b.x - g.mx) * g.tx + (b.y - g.my) * g.ty;
    const depth = (b) => (b.x - g.mx) * g.nx + (b.y - g.my) * g.ny;
    const ball = balls.reduce((a, b) => (depth(b) < depth(a) ? b : a));
    const span = (g.len - paddleLength(g.len, effectScale(bot))) / 2;
    const target = Math.max(-1, Math.min(1, along(ball) / span));
    const diff = target - bot.pos;
    bot.input = Math.abs(diff) < BOT_DEAD_ZONE ? 0 : Math.sign(diff);
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
    this.steerBot();
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
