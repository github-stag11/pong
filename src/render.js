import { layout, geometry, paddleLength, paddleCenter, BALL_RADIUS, SERVE_DELAY } from './game.js';

export const playerColor = (id) => `hsl(${(190 + id * 137.508) % 360} 95% 62%)`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.trail = [];
    this.stars = Array.from({ length: 180 }, () => ({
      x: Math.random(), y: Math.random(), z: Math.random(), phase: Math.random() * 6.28,
    }));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  drawStars(t) {
    const { ctx, w, h } = this;
    for (const s of this.stars) {
      const x = (((s.x * w + t * 4 * s.z) % w) + w) % w;
      const a = 0.35 + 0.35 * Math.sin(t * (0.6 + s.z) + s.phase);
      ctx.fillStyle = `rgba(200,220,255,${a})`;
      const size = 0.6 + s.z * 1.6;
      ctx.fillRect(x, s.y * h, size, size);
    }
  }

  // state: {players, ball, serve}; myId: id of the local player (or -1 for a spectator view).
  render(state, myId, t) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    this.drawStars(t);
    if (!state.players.length) return;

    const { sides, slots } = layout(state.players.length);
    const geo = geometry(sides);
    const mine = state.players.findIndex((p) => p.id === myId);
    const mySide = mine >= 0 ? slots[mine] : 0;
    const rot = Math.PI / 2 - geo[mySide].am; // put my side at the bottom of the screen
    const S = Math.min(w, h) * 0.38;
    const cx = w / 2;
    const cy = h / 2;
    const toScreen = (x, y) => [
      cx + S * (x * Math.cos(rot) - y * Math.sin(rot)),
      cy + S * (x * Math.sin(rot) + y * Math.cos(rot)),
    ];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(S, S);
    ctx.lineCap = 'round';

    ctx.beginPath();
    geo.forEach((g, i) => (i ? ctx.lineTo(g.ax, g.ay) : ctx.moveTo(g.ax, g.ay)));
    ctx.closePath();
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, 'rgba(60,50,140,0.28)');
    grad.addColorStop(1, 'rgba(10,10,40,0.35)');
    ctx.fillStyle = grad;
    ctx.fill();

    for (const g of geo) {
      ctx.strokeStyle = 'rgba(130,150,255,0.5)';
      ctx.lineWidth = 3 / S;
      ctx.beginPath();
      ctx.moveTo(g.ax, g.ay);
      ctx.lineTo(g.bx, g.by);
      ctx.stroke();
    }
    state.players.forEach((p, i) => {
      const g = geo[slots[i]];
      const color = playerColor(p.id);
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = color;
      ctx.lineWidth = (p.id === myId ? 5 : 3) / S;
      ctx.beginPath();
      ctx.moveTo(g.ax, g.ay);
      ctx.lineTo(g.bx, g.by);
      ctx.stroke();

      const pl = paddleLength(g.len);
      const c = paddleCenter(g.len, p.pos);
      const px = g.mx + g.nx * 0.03;
      const py = g.my + g.ny * 0.03;
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.moveTo(px + g.tx * (c - pl / 2), py + g.ty * (c - pl / 2));
      ctx.lineTo(px + g.tx * (c + pl / 2), py + g.ty * (c + pl / 2));
      ctx.stroke();
    });
    ctx.shadowBlur = 0;

    this.drawBall(state, S);
    ctx.restore();

    // Labels stay upright in screen space.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    state.players.forEach((p, i) => {
      const g = geo[slots[i]];
      const [x, y] = toScreen(g.mx - g.nx * 0.14, g.my - g.ny * 0.14);
      ctx.font = `${p.id === myId ? 700 : 500} 14px system-ui, sans-serif`;
      ctx.fillStyle = playerColor(p.id);
      ctx.fillText(`${p.name}${p.id === myId ? ' (you)' : ''}`, x, y - 8);
      ctx.fillStyle = 'rgba(230,235,255,0.85)';
      ctx.fillText(`lost ${p.lost}`, x, y + 8);
    });

    if (state.serve > 0) {
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(state.serve > SERVE_DELAY * 0.5 ? 'Get ready…' : 'Go!', cx, cy - S * 0.2);
    }
  }

  drawBall(state, S) {
    const { ctx } = this;
    const b = state.ball;
    if (state.serve > 0) this.trail.length = 0;
    else {
      this.trail.push([b.x, b.y]);
      if (this.trail.length > 14) this.trail.shift();
    }
    this.trail.forEach(([x, y], i) => {
      const f = i / this.trail.length;
      ctx.fillStyle = `rgba(255,200,120,${f * 0.35})`;
      ctx.beginPath();
      ctx.arc(x, y, BALL_RADIUS * (0.4 + f / 1.5), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.shadowColor = '#ffd27a';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#fff4d6';
    ctx.beginPath();
    ctx.arc(b.x, b.y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (state.serve > 0) {
      ctx.strokeStyle = 'rgba(255,230,160,0.5)';
      ctx.lineWidth = 2 / S;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_RADIUS * (1.6 + 0.5 * Math.sin(performance.now() / 120)), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
