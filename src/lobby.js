// Signaling for WebRTC over a public MQTT broker. Only the SDP offer and answer pass through it;
// game traffic is peer-to-peer. The broker is third-party and the lobby is open to anyone who knows the topics.
import mqtt from 'https://esm.sh/mqtt@5.10.3';

const BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const ROOT = 'spacepong/v1/lobby';
const HOST_TOPIC = `${ROOT}/host`;
const PROBE_MS = 2000;
const ANSWER_TIMEOUT_MS = 20000;

export const newId = () => Math.random().toString(36).slice(2, 10);

function connect(will) {
  const opts = { clientId: `sp-${newId()}`, clean: true, connectTimeout: 8000, reconnectPeriod: 0 };
  if (will) opts.will = will;
  return mqtt.connectAsync(BROKER, opts);
}

function parse(payload) {
  try { return JSON.parse(new TextDecoder().decode(payload)); } catch { return null; }
}

function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Resolves with the current host's {id, name}, or null if no host is announced.
export async function findHost() {
  const client = await connect();
  try {
    let deliver;
    const found = new Promise((resolve) => { deliver = resolve; });
    client.on('message', (topic, payload) => {
      if (topic !== HOST_TOPIC) return;
      const info = parse(payload);
      deliver(info && typeof info.id === 'string' ? info : null);
    });
    await client.subscribeAsync(HOST_TOPIC, { qos: 0 });
    return await withTimeout(found, PROBE_MS, null);
  } finally {
    client.end();
  }
}

// Announces this player as host and answers each incoming offer with onOffer(offerSdp), which resolves to the answer SDP.
// The returned close() clears the announcement.
export async function hostLobby({ id, name, onOffer }) {
  const joinTopic = `${ROOT}/join/${id}`;
  const will = { topic: HOST_TOPIC, payload: '', retain: true, qos: 1 };
  const client = await connect(will);

  client.on('message', async (topic, payload) => {
    if (topic !== joinTopic) return;
    const msg = parse(payload);
    if (!msg || typeof msg.from !== 'string' || typeof msg.sdp !== 'string') return;
    try {
      const sdp = await onOffer(msg.sdp);
      await client.publishAsync(`${ROOT}/answer/${msg.from}`, JSON.stringify({ sdp }));
    } catch {
      // The joiner's answer timeout reports the failure.
    }
  });

  await client.subscribeAsync(joinTopic, { qos: 0 });
  await client.publishAsync(HOST_TOPIC, JSON.stringify({ id, name }), { retain: true, qos: 1 });

  return {
    async close() {
      try { await client.publishAsync(HOST_TOPIC, '', { retain: true, qos: 1 }); } catch { /* broker gone */ }
      client.end();
    },
  };
}

// Sends an offer to the host and resolves with the host's answer SDP.
// makeOffer() runs after the answer topic is subscribed, so the host's reply cannot be missed.
export async function joinHost({ hostId, playerId, makeOffer }) {
  const client = await connect();
  try {
    const answerTopic = `${ROOT}/answer/${playerId}`;
    let deliver;
    const answer = new Promise((resolve) => { deliver = resolve; });
    client.on('message', (topic, payload) => {
      if (topic !== answerTopic) return;
      const msg = parse(payload);
      if (msg && typeof msg.sdp === 'string') deliver(msg.sdp);
    });
    await client.subscribeAsync(answerTopic, { qos: 0 });

    const sdp = await makeOffer();
    await client.publishAsync(`${ROOT}/join/${hostId}`, JSON.stringify({ from: playerId, sdp }));

    const reply = await withTimeout(answer, ANSWER_TIMEOUT_MS, null);
    if (!reply) throw new Error('The host did not answer. The lobby may have closed.');
    return reply;
  } finally {
    client.end();
  }
}
