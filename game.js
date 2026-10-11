(() => {
'use strict';

// ---------- constants ----------
const W = 720, H = 1280, CX = 360, CY = 600, R = 335;
const STEP = 1000 / 60;
const GRID_COLS = 36, GRID_CELL = 20, GRID_Y = 1032;
const cv = document.getElementById('c');
cv.width = W; cv.height = H;
const ctx = cv.getContext('2d');
const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, +params.get('speed') || 2);

// ---------- state ----------
let codes = [], imgs = {}, total = 0;
let round = 1, winners = [], winnerNo = 0;
let flags = [], elim = [], parts = [], pulses = [];
let mode = 'play', winT = 0, gap = -Math.PI / 2, gapHalf = 0.26;
let flash = 0, shake = 0;

const dn = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { return null; } })();
const nameOf = c => { try { return dn ? dn.of(c.toUpperCase()) : c.toUpperCase(); } catch (e) { return c.toUpperCase(); } };
const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).catch(() => {});
const saveState = r => post('/api/state', { round: r, winners, winnerNo });


// ---------- audio (WebAudio, captured by the stream through a virtual sink) ----------
let ac = null, master = null, lastBounce = 0, lastPop = 0;
const MUSIC = params.get('music') !== '0', MUTED = params.get('mute') === '1';
const PENTA = [0, 2, 4, 7, 9];
const hz = n => 261.63 * Math.pow(2, n / 12);
(function initAudio() {
  if (MUTED) return;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ac.createDynamicsCompressor();
    master = ac.createGain(); master.gain.value = 0.7;
    master.connect(comp); comp.connect(ac.destination);
    const wake = () => { if (ac && ac.state !== 'running') ac.resume().catch(() => {}); };
    ['pointerdown', 'keydown', 'touchstart'].forEach(e => addEventListener(e, wake, { passive: true }));
    wake();
  } catch (e) { ac = null; }
})();
function tone(f0, f1, dur, type, vol, when) {
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime + (when || 0);
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
function sfxBounce() {
  if (!ac) return;
  const t = ac.currentTime;
  if (t - lastBounce < 0.08) return;
  lastBounce = t;
  const f = hz(PENTA[(Math.random() * 5) | 0] + (Math.random() < 0.5 ? 12 : 24));
  tone(f * 1.25, f * 0.8, 0.14, 'sine', 0.16);          // rubbery "boing"
}
function sfxPop() {
  if (!ac) return;
  const t = ac.currentTime;
  if (t - lastPop < 0.06) return;
  lastPop = t;
  tone(900, 140, 0.16, 'square', 0.07);
  tone(1500, 400, 0.08, 'sine', 0.10);
}
function sfxWin() {
  if (!ac) return;
  [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => tone(hz(n), hz(n), 0.45, 'triangle', 0.2, i * 0.11));
  [12, 16, 19, 24].forEach(n => tone(hz(n), hz(n), 1.4, 'sine', 0.12, 0.8));
  for (let i = 0; i < 10; i++) tone(2000 + Math.random() * 2500, 1000, 0.12, 'sine', 0.05, 0.9 + i * 0.09);
}
// light bouncy bass loop, 120 bpm
const BASS = [0, 0, 7, 5, 0, 0, 9, 7], BASS2 = [4, 4, 11, 9, 4, 4, 12, 11];
let beat = 0;
if (MUSIC && !MUTED) setInterval(() => {
  if (!ac || ac.state !== 'running' || mode === 'win') return;
  const pat = (beat >> 3) % 2 ? BASS2 : BASS, n = pat[beat % 8] - 24;
  tone(hz(n), hz(n) * 0.97, 0.2, 'triangle', 0.2);
  if (beat % 2 === 0) tone(hz(n + 12), hz(n + 12), 0.09, 'sine', 0.04);
  beat++;
}, 250);

// ---------- background (pre-rendered once) ----------
const bg = document.createElement('canvas');
bg.width = W; bg.height = H;
(() => {
  const g = bg.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#3fd0ff'); gr.addColorStop(1, '#1a86ee');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.16)';
  for (let i = 0; i < 28; i++) {
    g.beginPath();
    g.arc(Math.random() * W, Math.random() * H, 40 + Math.random() * 90, 0, 7);
    g.fill();
  }
})();

// ---------- helpers ----------
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function drawFlag(c, x, y, r, bw) {
  if (!(r > 0)) return;
  const im = imgs[c];
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
  if (im) {
    const h = r * 2, w = h * im.width / im.height;
    ctx.drawImage(im, x - w / 2, y - r, w, h);
  } else {
    let hh = 0; for (const ch of c) hh = (hh * 31 + ch.charCodeAt(0)) % 360;
    ctx.fillStyle = 'hsl(' + hh + ',60%,45%)'; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.max(7, r * 0.9) + 'px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.toUpperCase(), x, y);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
  if (bw) {
    ctx.lineWidth = bw; ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
  }
}

const gridPos = i => ({ x: GRID_CELL / 2 + (i % GRID_COLS) * GRID_CELL, y: GRID_Y + GRID_CELL / 2 + Math.floor(i / GRID_COLS) * GRID_CELL });

// ---------- round control ----------
function newRound() {
  flags = []; elim = []; parts = []; pulses = [];
  mode = 'play'; flash = 0;
  for (const c of codes) {
    const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * (R - 40), s = Math.random() * 6.283;
    flags.push({ c, x: CX + Math.cos(a) * d, y: CY + Math.sin(a) * d, vx: Math.cos(s) * 3.2, vy: Math.sin(s) * 3.2, r: 10.5 });
  }
  gap = Math.random() * 6.283;
  saveState(round);
}

function startWin() {
  mode = 'win'; winT = performance.now(); flash = 1; shake = 30; sfxWin();
  const f = flags[0];
  f.sx = f.x; f.sy = f.y; f.sr = f.r; f.tx = CX; f.ty = CY + 10; f.tr = 120; f.i = 0;
  winnerNo += 1;
  winners = winners.concat([{ c: f.c, no: winnerNo }]).slice(-2);
  for (let i = 0; i < 220; i++) confetti(CX, CY, true);
  saveState(round + 1);
}

const COLORS = ['#ffd23f', '#ff4d6d', '#4dd2ff', '#7cff6b', '#ffffff', '#c77dff', '#ff9f1c'];
function confetti(x, y, burst) {
  const a = burst ? Math.random() * 6.283 : Math.PI / 2 + (Math.random() - 0.5) * 0.6;
  const s = burst ? 3 + Math.random() * 10 : 1 + Math.random() * 3;
  parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (burst ? 4 : 0), rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, w: 6 + Math.random() * 8, h: 3 + Math.random() * 5, col: COLORS[(Math.random() * COLORS.length) | 0], life: 1 });
}

// ---------- physics ----------
function step() {
  const n = flags.length;
  const base = 3.2 + (1 - n / total) * 2.2;
  gapHalf = n > 20 ? 0.26 : 0.26 + (20 - n) * 0.012;
  gap += 0.009;
  const tr = n > 100 ? 10.5 : n > 40 ? 13 : n > 15 ? 17 : n > 6 ? 22 : 28;
  for (const f of flags) {
    f.r += (tr - f.r) * 0.03;
    f.x += f.vx; f.y += f.vy;
    const dx = f.x - CX, dy = f.y - CY, d = Math.hypot(dx, dy) || 1;
    if (d > R - f.r) {
      let df = Math.atan2(dy, dx) - gap;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      if (Math.abs(df) < gapHalf) {
        if (d > R + f.r * 0.4) f.out = true;
      } else {
        const nx = dx / d, ny = dy / d, dot = f.vx * nx + f.vy * ny;
        if (dot > 0) { f.vx -= 2 * dot * nx; f.vy -= 2 * dot * ny; sfxBounce(); }
        f.x = CX + nx * (R - f.r); f.y = CY + ny * (R - f.r);
      }
    }
  }
  for (let i = 0; i < flags.length; i++) {
    const a = flags[i];
    for (let j = i + 1; j < flags.length; j++) {
      const b = flags[j];
      const dx = b.x - a.x, dy = b.y - a.y, rs = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 < rs * rs && d2 > 0.0001) {
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = (rs - d) / 2;
        a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) { a.vx += rel * nx; a.vy += rel * ny; b.vx -= rel * nx; b.vy -= rel * ny; }
      }
    }
  }
  for (const f of flags) {
    const s = Math.hypot(f.vx, f.vy) || 1;
    f.vx *= base / s; f.vy *= base / s;
  }
  // eliminations: never let the last two leave
  let remaining = flags.length;
  const now = performance.now();
  for (const f of flags) {
    if (!f.out) continue;
    if (remaining <= 1) { f.out = false; f.vx = -f.vx; f.vy = -f.vy; continue; }
    remaining--;
    elim.push({ c: f.c, fx: f.x, fy: f.y, fr: f.r, t: now }); sfxPop();
    pulses.push({ x: f.x, y: f.y, t: now });
  }
  flags = flags.filter(f => !f.out);
  if (flags.length <= 1 && mode === 'play') startWin();
}

function updateFx(k, now) {
  for (const p of parts) {
    p.x += p.vx * k; p.y += p.vy * k; p.vy += 0.15 * k; p.vx *= 0.995;
    p.rot += p.vr * k; p.life -= 0.0025 * k;
  }
  parts = parts.filter(p => p.life > 0 && p.y < H + 30);
  if (mode === 'win' && now - winT < 5000) {
    for (let i = 0; i < 3; i++) confetti(Math.random() * W, -10, false);
    if (Math.random() < 0.04) for (let i = 0; i < 60; i++) confetti(80 + Math.random() * 560, 200 + Math.random() * 300, true);
  }
  if (flash > 0) flash = Math.max(0, flash - 0.02 * k);
  if (shake > 0) shake = Math.max(0, shake - 0.8 * k);
}

// ---------- drawing ----------
function drawRing(gold) {
  const a0 = gap + gapHalf, a1 = gap - gapHalf + Math.PI * 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = gold ? '#b8860b' : '#0b4bd8'; ctx.lineWidth = 18;
  ctx.beginPath(); ctx.arc(CX, CY, R + 2, a0, a1); ctx.stroke();
  ctx.strokeStyle = gold ? '#ffe27a' : '#ffffff'; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(CX, CY, R + 2, a0, a1); ctx.stroke();
}

function drawHud() {
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#10244f'; rr(20, 24, 450, 136, 22); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center';
  ctx.fillText('WINNERS', 245, 58);
  for (let i = 0; i < 2; i++) {
    const y = 70 + i * 40, w = winners[i];
    ctx.fillStyle = 'rgba(255,255,255,.09)'; rr(36, y, 418, 34, 8); ctx.fill();
    ctx.textAlign = 'left';
    if (w) {
      ctx.fillStyle = '#8fa6d8'; ctx.font = 'bold 15px Arial'; ctx.fillText('#' + w.no, 46, y + 23);
      drawFlag(w.c, 112, y + 17, 12, 0);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Arial'; ctx.fillText(nameOf(w.c), 134, y + 25, 230);
      ctx.textAlign = 'right'; ctx.fillStyle = '#ffc928'; ctx.font = 'bold 17px Arial'; ctx.fillText('WIN', 442, y + 24);
    } else {
      ctx.fillStyle = '#8fa6d8'; ctx.font = 'bold 18px Arial'; ctx.fillText('waiting for the first winner...', 50, y + 24);
    }
  }
  ctx.fillStyle = '#10244f'; rr(486, 24, 214, 136, 22); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.stroke();
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Arial'; ctx.fillText('FLAGS LEFT', 593, 56);
  ctx.fillStyle = '#ffc928'; ctx.font = 'bold 62px Arial'; ctx.textAlign = 'right'; ctx.fillText(String(flags.length), 590, 114);
  ctx.fillStyle = '#c9d6ff'; ctx.font = 'bold 17px Arial'; ctx.textAlign = 'left'; ctx.fillText('OF ' + total, 598, 112);
  ctx.fillStyle = 'rgba(255,255,255,.15)'; rr(506, 134, 174, 8, 4); ctx.fill();
  ctx.fillStyle = '#ffc928'; rr(506, 134, Math.max(8, 174 * flags.length / total), 8, 4); ctx.fill();

  const pills = [['ROUND ' + round, 70], ['2x SPEED', 70], ['LIVE', 42]];
  let x = 20;
  ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center';
  for (const [t, w0] of pills) {
    const w = Math.max(w0, ctx.measureText(t).width + 28) + 8;
    ctx.fillStyle = t === 'LIVE' ? '#e5252a' : '#10244f'; rr(x, 176, w, 30, 15); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(t, x + w / 2, 197);
    x += w + 10;
  }
}

function drawElim(now) {
  ctx.fillStyle = '#fff'; ctx.font = 'bold 17px Arial'; ctx.textAlign = 'left';
  ctx.fillText('ELIMINATED', 14, 1016);
  ctx.textAlign = 'right'; ctx.fillText((total - flags.length) + ' / ' + total, W - 14, 1016);
  elim.forEach((e, i) => {
    const g = gridPos(i), p = Math.max(0, Math.min(1, (now - e.t) / 450)), k = 1 - Math.pow(1 - p, 3);
    drawFlag(e.c, e.fx + (g.x - e.fx) * k, e.fy + (g.y - e.fy) * k, e.fr + (8.5 - e.fr) * k, 0);
  });
}

function drawFooter() {
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 46px Arial';
  ctx.shadowColor = 'rgba(0,40,120,.6)'; ctx.shadowBlur = 8;
  ctx.fillText('COUNTRY FLAG BATTLE', CX, 1200);
  ctx.font = 'bold 26px Arial'; ctx.fillText('Who will win? \u{1F3C6}', CX, 1245);
  ctx.shadowBlur = 0;
}

function drawWin(now) {
  const t = (now - winT) / 1000;
  ctx.fillStyle = 'rgba(0,25,80,.35)'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(CX, CY); ctx.rotate(t * 0.5);
  for (let i = 0; i < 14; i++) {
    ctx.rotate(Math.PI * 2 / 14);
    ctx.fillStyle = 'rgba(255,230,120,.22)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-60, -R * 1.7); ctx.lineTo(60, -R * 1.7); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  for (let k = 0; k < 3; k++) {
    const ph = (t * 0.8 + k / 3) % 1;
    ctx.strokeStyle = 'rgba(255,215,0,' + (1 - ph) + ')'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(CX, CY, ph * R * 1.1, 0, 7); ctx.stroke();
  }
  drawRing(true);
  const p = Math.min(1, t / 1.2), e = 1 - Math.pow(1 - p, 3);
  for (const f of flags.slice(0, 1)) {
    const x = f.sx + (f.tx - f.sx) * e;
    const y = f.sy + (f.ty - f.sy) * e + (p >= 1 ? Math.sin(t * 3 + f.i) * 7 : 0);
    const r = f.sr + (f.tr - f.sr) * e;
    ctx.fillStyle = 'rgba(255,215,0,' + (0.25 + 0.1 * Math.sin(t * 6)) + ')';
    ctx.beginPath(); ctx.arc(x, y, r + 16 + Math.sin(t * 5) * 4, 0, 7); ctx.fill();
    drawFlag(f.c, x, y, r, 6);
    ctx.font = Math.round(r * 0.9) + 'px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    ctx.fillText('\u{1F451}', x, y - r - 8);
    ctx.font = 'bold 36px Arial'; ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 6;
    ctx.fillText(nameOf(f.c), x, y + r + 50, 420); ctx.shadowBlur = 0;
  }
  const s = 1 + Math.sin(t * 6) * 0.06;
  ctx.save(); ctx.translate(CX, CY - 230); ctx.scale(s, s);
  ctx.font = 'bold 96px Arial'; ctx.textAlign = 'center';
  ctx.lineWidth = 12; ctx.strokeStyle = '#8a5a00'; ctx.strokeText('WINNER!', 0, 0);
  ctx.fillStyle = '#ffe27a'; ctx.fillText('WINNER!', 0, 0);
  ctx.restore();
}

function drawParts() {
  for (const p of parts) {
    ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
}

function draw(now) {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  ctx.drawImage(bg, 0, 0);
  if (mode === 'play') {
    drawRing(false);
    for (const p of pulses) {
      const k = Math.max(0, (now - p.t) / 500);
      if (k < 1) { ctx.strokeStyle = 'rgba(255,255,255,' + (1 - k) + ')'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y, 10 + k * 40, 0, 7); ctx.stroke(); }
    }
    pulses = pulses.filter(p => now - p.t < 500);
    for (const f of flags) drawFlag(f.c, f.x, f.y, f.r, 2);
  } else {
    drawWin(now);
  }
  drawElim(now);
  drawHud();
  drawFooter();
  drawParts();
  if (flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + flash * 0.8 + ')'; ctx.fillRect(0, 0, W, H); }
  ctx.restore();
}

// ---------- main loop ----------
let last = 0, acc = 0;
function loop(now) {
  const dt = Math.min(100, now - last); last = now;
  if (mode === 'play') {
    acc += dt * SPEED;
    while (acc >= STEP) { step(); acc -= STEP; if (mode !== 'play') { acc = 0; break; } }
  }
  updateFx(dt / STEP, now);
  if (mode === 'win' && now - winT > 9000) { round++; newRound(); }
  try { draw(now); } catch (e) { console.error(e); }
  requestAnimationFrame(loop);
}

async function boot() {
  codes = (await (await fetch('codes.txt')).text()).trim().split(/\s+/);
  total = codes.length;
  await Promise.all(codes.map(c => new Promise(res => {
    const im = new Image();
    im.onload = () => { imgs[c] = im; res(); };
    im.onerror = () => res();
    im.src = 'flags/' + c + '.png';
  })));
  try {
    const s = await (await fetch('/api/state')).json();
    round = s.round || 1; winners = s.winners || []; winnerNo = s.winnerNo || 0;
  } catch (e) {}
  newRound();
  last = performance.now();
  requestAnimationFrame(loop);
}

window.__game = { get audio() { return ac ? ac.state : 'off'; }, get flags() { return flags; }, get mode() { return mode; }, get round() { return round; } };
boot();
})();
