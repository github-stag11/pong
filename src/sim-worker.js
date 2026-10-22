// Dedicated worker that runs the host's match simulation off the main thread (see sim-core.js).
import { MatchSim } from './sim-core.js';

const TICK_MS = 1000 / 60;

let sim = null;
let last = 0;

const rosterMessage = () => ({ t: 'roster', ...sim.roster() });

function frame() {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  // Roster goes first so the main thread's rv matches the snapshot it applies.
  const { events, roster, send } = sim.advance(dt);
  if (roster) self.postMessage(rosterMessage());
  self.postMessage({ t: 'tick', snap: sim.snapshot(), send, events });
}

self.onmessage = ({ data }) => {
  switch (data.t) {
    case 'init':
      sim = new MatchSim(data.id, data.name);
      last = performance.now();
      self.postMessage(rosterMessage());
      setInterval(frame, TICK_MS);
      break;
    case 'add':
      sim.addPlayer(data.id, data.name);
      self.postMessage(rosterMessage());
      break;
    case 'remove':
      if (sim.removePlayer(data.id)) self.postMessage(rosterMessage());
      break;
    case 'pos':
      sim.setPos(data.id, data.pos);
      break;
    case 'input':
      sim.setInput(data.id, data.dir);
      break;
  }
};
