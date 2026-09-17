/* The labyrinth engine: a raycaster over the grid the contract holds. No asset files: wall textures are arithmetic,
   the station plaques are text drawn on the fly, sounds are synthesized. It records every cell you cross as a move
   (0 up, 1 right, 2 down, 3 left), which is exactly what the contract later walks. */

export function mount(canvas, board, hooks = {}) {
  const W = board.w, H = board.h, MAP = board.map, START = board.start, EXIT = board.exit, CP = board.checkpoints, LABELS = board.labels, NOTES = board.notes || [];
  const wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || MAP[y * W + x] !== 0;
  const cellOf = (x, y) => (y | 0) * W + (x | 0);
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------ textures, drawn once */
  const TS = 64;
  function texture(fn) { const c = document.createElement('canvas'); c.width = c.height = TS; const g = c.getContext('2d'); const id = g.createImageData(TS, TS); for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) { const [r, gg, b] = fn(x, y); const i = (y * TS + x) * 4; id.data[i] = r; id.data[i + 1] = gg; id.data[i + 2] = b; id.data[i + 3] = 255; } g.putImageData(id, 0, 0); return g.getImageData(0, 0, TS, TS).data; }
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; };
  /* concrete slabs with a seam every 16 px and a faint circuit trace */
  const T_WALL = texture((x, y) => { const seam = (x % 32 === 0 || y % 16 === 0) ? .55 : 1; const n = .85 + hash(x, y) * .15; const trace = ((y % 16 === 7 && x % 32 < 20) || (x % 32 === 19 && y % 16 >= 4 && y % 16 <= 7)) ? 1.35 : 1; const v = 74 * seam * n * trace; return [v * .95, v * 1.05, v * .98]; });
  /* station walls: darker, with a lit strip */
  const T_STATION = texture((x, y) => { const strip = y >= 28 && y <= 35 ? 1 : 0; const n = .8 + hash(x, y) * .2; const base = 48 * n; return strip ? [120 + hash(x, y) * 40, 235, 150] : [base * .9, base, base * .95]; });
  /* the exit: a doorway of light */
  const T_EXIT = texture((x, y) => { const d = Math.abs(x - 32) / 32; const v = 200 - d * 120 + hash(x, y) * 20; return [v * .85, v, v * .9]; });
  const stationCell = new Set(CP);
  /* which cells are station walls: the walls around a station cell */
  const nearStation = new Set(); for (const c of CP) { const x = c % W, y = (c / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (wall(x + dx, y + dy)) nearStation.add((y + dy) * W + x + dx); }
  const nearExit = new Set(); { const x = EXIT % W, y = (EXIT / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (wall(x + dx, y + dy)) nearExit.add((y + dy) * W + x + dx); }

  /* plaques: one offscreen canvas per station, text only */
  function plaque(i) { const c = document.createElement('canvas'); c.width = 256; c.height = 160; const g = c.getContext('2d'); g.fillStyle = '#0b120e'; g.fillRect(0, 0, 256, 160); g.strokeStyle = '#3ddc7a'; g.lineWidth = 4; g.strokeRect(6, 6, 244, 148); g.fillStyle = '#3ddc7a'; g.font = 'bold 56px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.fillText(String(LABELS[i]).slice(0, 4), 128, 74); g.fillStyle = '#e8f3ea'; g.font = '18px ui-monospace, Menlo, monospace'; const t = String(LABELS[i]).slice(5); const words = t.split(' '), lines = []; let cur = ''; for (const w of words) { if ((cur + ' ' + w).trim().length > 22) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; } lines.push(cur.trim()); lines.slice(0, 2).forEach((l, k) => g.fillText(l, 128, 108 + k * 24)); return c; }
  const PLAQUES = CP.map((_, i) => plaque(i));
  const EXIT_SIGN = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d'); g.fillStyle = '#0b120e'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#e8f3ea'; g.font = 'bold 60px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.fillText('EXIT', 128, 68); return c; })();

  /* ------------------------------------------------------------ state */
  const S = { x: (START % W) + .5, y: ((START / W) | 0) + .5, a: 0, cell: START, moves: [], reached: 0, steps: 0, t0: 0, done: false, visited: new Set([START]), toast: null, toastAt: 0, started: false };
  /* face the open direction at the start */
  for (const [d, a] of [[1, 0], [W, Math.PI / 2], [-1, Math.PI], [-W, -Math.PI / 2]]) if (!wall((START + d) % W, ((START + d) / W) | 0) && MAP[START + d] === 0) { S.a = a; break; }
  const keys = {};
  let mouseDx = 0, touchMove = { x: 0, y: 0 }, touchTurn = 0;

  /* ------------------------------------------------------------ sound, synthesized */
  let AC = null, muted = false;
  function beep(f, len, type = 'square', vol = .04) { if (muted || RM) return; try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.value = f; g.gain.value = vol; o.connect(g); g.connect(AC.destination); o.start(); g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + len); o.stop(AC.currentTime + len); } catch {} }
  function chime() { beep(660, .18); setTimeout(() => beep(880, .22), 120); setTimeout(() => beep(1320, .3, 'triangle'), 240); }

  /* ------------------------------------------------------------ input */
  const isTouch = matchMedia('(pointer: coarse)').matches;
  addEventListener('keydown', e => { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault(); keys[e.key.toLowerCase()] = true; });
  addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  canvas.addEventListener('click', () => { if (!isTouch && document.pointerLockElement !== canvas) canvas.requestPointerLock && canvas.requestPointerLock(); begin(); });
  addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) mouseDx += e.movementX; });
  let tl = null, tr = null;
  canvas.addEventListener('touchstart', e => { begin(); for (const t of e.changedTouches) { const half = t.clientX < innerWidth / 2; if (half && !tl) tl = { id: t.identifier, x: t.clientX, y: t.clientY }; else if (!half && !tr) tr = { id: t.identifier, x: t.clientX }; } e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchmove', e => { for (const t of e.changedTouches) { if (tl && t.identifier === tl.id) touchMove = { x: Math.max(-1, Math.min(1, (t.clientX - tl.x) / 50)), y: Math.max(-1, Math.min(1, (tl.y - t.clientY) / 50)) }; if (tr && t.identifier === tr.id) { touchTurn += (t.clientX - tr.x) * .006; tr.x = t.clientX; } } e.preventDefault(); }, { passive: false });
  const endTouch = e => { for (const t of e.changedTouches) { if (tl && t.identifier === tl.id) { tl = null; touchMove = { x: 0, y: 0 }; } if (tr && t.identifier === tr.id) tr = null; } };
  canvas.addEventListener('touchend', endTouch); canvas.addEventListener('touchcancel', endTouch);
  function begin() { if (S.started || S.done) return; S.started = true; S.t0 = performance.now(); hooks.onStart && hooks.onStart(); }

  /* ------------------------------------------------------------ movement and the move log */
  function tryMove(nx, ny) { const r = .22; if (!wall((nx - r) | 0, S.y | 0) && !wall((nx + r) | 0, S.y | 0)) S.x = nx; if (!wall(S.x | 0, (ny - r) | 0) && !wall(S.x | 0, (ny + r) | 0)) S.y = ny; }
  function step(dt) {
    if (!S.started || S.done) return;
    let f = 0, s = 0, turn = 0;
    if (keys['w'] || keys['arrowup']) f += 1; if (keys['s'] || keys['arrowdown']) f -= 1;
    if (keys['q']) s -= 1; if (keys['e']) s += 1;
    if (keys['a'] || keys['arrowleft']) turn -= 1; if (keys['d'] || keys['arrowright']) turn += 1;
    f += touchMove.y; s += touchMove.x;
    S.a += turn * 2.4 * dt + mouseDx * .0022 + touchTurn; mouseDx = 0; touchTurn = 0;
    const sp = 2.6 * dt, ca = Math.cos(S.a), sa = Math.sin(S.a);
    if (f || s) tryMove(S.x + (ca * f - sa * s) * sp, S.y + (sa * f + ca * s) * sp);
    const c = cellOf(S.x, S.y);
    if (c !== S.cell) {
      const d = c - S.cell; const m = d === -W ? 0 : d === 1 ? 1 : d === W ? 2 : d === -1 ? 3 : -1;
      if (m >= 0) { S.moves.push(m); S.steps++; S.cell = c; S.visited.add(c); if (!RM) beep(140 + (S.steps % 2) * 20, .05, 'triangle', .012); }
      else { S.x = (S.cell % W) + .5; S.y = ((S.cell / W) | 0) + .5; }
      if (S.reached < CP.length && c === CP[S.reached]) { S.reached++; S.toast = S.reached - 1; S.toastAt = performance.now(); chime(); hooks.onStation && hooks.onStation(S.reached - 1); }
      if (c === EXIT && S.reached === CP.length) { S.done = true; document.exitPointerLock && document.exitPointerLock(); beep(520, .4, 'sawtooth', .05); hooks.onFinish && hooks.onFinish(summary()); }
      hooks.onStep && hooks.onStep(summary());
    }
  }
  const summary = () => ({ steps: S.steps, moves: S.moves.slice(), reached: S.reached, seconds: S.started ? (performance.now() - S.t0) / 1000 : 0, done: S.done, cell: S.cell, x: S.x, y: S.y, a: S.a });

  /* ------------------------------------------------------------ rendering */
  const ctx = canvas.getContext('2d');
  let RW = 480, RH = 270, img = null, z = null;
  function size() { const r = canvas.getBoundingClientRect(); RW = Math.min(640, Math.max(240, Math.round(r.width / 2))); RH = Math.round(RW * r.height / Math.max(1, r.width)); canvas.width = RW; canvas.height = RH; img = ctx.createImageData(RW, RH); z = new Float32Array(RW); }
  size(); addEventListener('resize', size);
  const FOV = Math.PI / 3, FOG = 9;
  function render(now) {
    if (!img) return;
    const d = img.data, half = RH / 2;
    /* ceiling and floor with fog toward the horizon */
    for (let y = 0; y < RH; y++) { const dy = Math.abs(y - half) / half; const c = y < half ? [14 + 10 * dy, 18 + 14 * dy, 16 + 12 * dy] : [24 + 22 * dy, 30 + 26 * dy, 27 + 24 * dy]; for (let x = 0; x < RW; x++) { const i = (y * RW + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; } }
    const ca = Math.cos(S.a), sa = Math.sin(S.a), px = -sa * Math.tan(FOV / 2), py = ca * Math.tan(FOV / 2);
    for (let col = 0; col < RW; col++) {
      const cam = 2 * col / RW - 1, rx = ca + px * cam, ry = sa + py * cam;
      let mx = S.x | 0, my = S.y | 0; const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry);
      let sx, sy, sdx, sdy; if (rx < 0) { sx = -1; sdx = (S.x - mx) * ddx; } else { sx = 1; sdx = (mx + 1 - S.x) * ddx; } if (ry < 0) { sy = -1; sdy = (S.y - my) * ddy; } else { sy = 1; sdy = (my + 1 - S.y) * ddy; }
      let side = 0, hit = 0, guard = 0;
      while (!hit && guard++ < 128) { if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; } if (wall(mx, my)) hit = 1; }
      const dist = side === 0 ? sdx - ddx : sdy - ddy; z[col] = dist;
      const lh = Math.max(1, (RH / Math.max(.05, dist)) | 0), y0 = Math.max(0, (half - lh / 2) | 0), y1 = Math.min(RH - 1, (half + lh / 2) | 0);
      let wx = side === 0 ? S.y + dist * ry : S.x + dist * rx; wx -= Math.floor(wx);
      const cellIdx = my * W + mx, tex = nearExit.has(cellIdx) ? T_EXIT : nearStation.has(cellIdx) ? T_STATION : T_WALL;
      const tx = ((wx * TS) | 0) & (TS - 1);
      const fog = Math.max(0, 1 - dist / FOG), shade = (side ? .72 : 1) * fog;
      for (let y = y0; y <= y1; y++) { const ty = (((y - (half - lh / 2)) / lh) * TS) | 0; const ti = ((ty & (TS - 1)) * TS + tx) * 4, i = (y * RW + col) * 4; d[i] = tex[ti] * shade; d[i + 1] = tex[ti + 1] * shade; d[i + 2] = tex[ti + 2] * shade; }
    }
    ctx.putImageData(img, 0, 0);
    /* sprites: plaques at stations still ahead, the exit sign, sorted far to near */
    const sprites = [];
    CP.forEach((c, i) => { sprites.push({ x: (c % W) + .5, y: ((c / W) | 0) + .5, img: PLAQUES[i], w: .62, h: .4, lift: .05, dim: i < S.reached }); });
    sprites.push({ x: (EXIT % W) + .5, y: ((EXIT / W) | 0) + .5, img: EXIT_SIGN, w: .7, h: .26, lift: .25, dim: false });
    for (const s of sprites) { const dx = s.x - S.x, dy = s.y - S.y; s.d = dx * dx + dy * dy; }
    sprites.sort((a, b) => b.d - a.d);
    const inv = 1 / (px * sa - ca * py);
    for (const s of sprites) {
      const dx = s.x - S.x, dy = s.y - S.y, tX = inv * (sa * dx - ca * dy), tY = inv * (-py * dx + px * dy);
      if (tY <= .1) continue;
      const scx = ((RW / 2) * (1 + tX / tY)) | 0, hgt = Math.abs((RH / tY) * s.h) | 0, wid = Math.abs((RH / tY) * s.w) | 0;
      const top = (half - hgt / 2 - (RH / tY) * s.lift) | 0, x0 = Math.max(0, scx - wid / 2 | 0), x1 = Math.min(RW - 1, scx + wid / 2 | 0);
      if (x1 <= x0) continue;
      /* draw column by column against the z buffer */
      ctx.globalAlpha = (s.dim ? .35 : 1) * Math.max(.15, 1 - Math.sqrt(s.d) / FOG);
      for (let x = x0; x <= x1; x++) { if (z[x] <= tY) continue; const u = (x - (scx - wid / 2)) / wid; ctx.drawImage(s.img, (u * s.img.width) | 0, 0, 1, s.img.height, x, top, 1, hgt); }
      ctx.globalAlpha = 1;
    }
    /* vignette and a hairline crosshair */
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(0, 0, RW, 6); ctx.fillRect(0, RH - 6, RW, 6);
    ctx.strokeStyle = 'rgba(232,243,234,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(RW / 2 - 4, half); ctx.lineTo(RW / 2 + 4, half); ctx.moveTo(RW / 2, half - 4); ctx.lineTo(RW / 2, half + 4); ctx.stroke();
    /* minimap: only what you have walked */
    const ms = Math.max(2, (RW / 200) | 0), mw = W * ms, ox = RW - mw - 8, oy = 8;
    ctx.fillStyle = 'rgba(8,11,9,.75)'; ctx.fillRect(ox - 3, oy - 3, mw + 6, H * ms + 6);
    for (const c of S.visited) { const x = c % W, y = (c / W) | 0; ctx.fillStyle = stationCell.has(c) ? '#3ddc7a' : c === EXIT ? '#e8f3ea' : 'rgba(232,243,234,.35)'; ctx.fillRect(ox + x * ms, oy + y * ms, ms, ms); }
    ctx.fillStyle = '#ffb02e'; ctx.fillRect(ox + (S.x | 0) * ms, oy + (S.y | 0) * ms, ms, ms);
    /* the toast when a station is reached */
    if (S.toast !== null && now - S.toastAt < 3200) { const a = Math.min(1, (3200 - (now - S.toastAt)) / 600); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(8,11,9,.85)'; ctx.fillRect(RW / 2 - 150, RH - 60, 300, 44); ctx.fillStyle = '#3ddc7a'; ctx.font = 'bold 12px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; ctx.fillText(LABELS[S.toast], RW / 2, RH - 42); ctx.fillStyle = '#e8f3ea'; ctx.font = '9px ui-monospace, Menlo, monospace'; ctx.fillText((NOTES[S.toast] || '').slice(0, 60), RW / 2, RH - 26); ctx.globalAlpha = 1; }
    if (!S.started) { ctx.fillStyle = 'rgba(8,11,9,.6)'; ctx.fillRect(0, 0, RW, RH); ctx.fillStyle = '#e8f3ea'; ctx.font = 'bold 14px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; ctx.fillText(isTouch ? 'touch to enter' : 'click to enter', RW / 2, half - 6); ctx.font = '10px ui-monospace, Menlo, monospace'; ctx.fillStyle = 'rgba(232,243,234,.7)'; ctx.fillText(isTouch ? 'left half moves, right half turns' : 'W A S D to move and turn, Q E to strafe, mouse to look', RW / 2, half + 14); }
  }
  let last = performance.now(), raf = 0;
  function loop(now) { const dt = Math.min(.05, (now - last) / 1000); last = now; step(dt); render(now); raf = requestAnimationFrame(loop); }
  raf = requestAnimationFrame(loop);
  return { summary, mute(v) { muted = v; }, destroy() { cancelAnimationFrame(raf); } };
}
