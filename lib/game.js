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
  /* three eras of wall, chosen by how far along the path a cell sits: riveted steel and dials for the fifties,
     circuit board for the eighties and nineties, server racks with lamps for the twenties */
  const T_STEEL = texture((x, y) => { const rivet = ((x % 32 === 4 || x % 32 === 27) && (y % 32 === 4 || y % 32 === 27)) ? 1.6 : 1; const seam = (x % 32 === 0 || y % 32 === 0) ? .5 : 1; const dial = ((x - 16) ** 2 + (y - 48) ** 2 < 30 && x < 32) ? .72 : ((x - 16) ** 2 + (y - 48) ** 2 < 42 && x < 32) ? 1.3 : 1; const n = .88 + hash(x, y) * .12; const v = 96 * seam * n * rivet * dial; return [v * 1.02, v * .98, v * .9]; });
  const T_BOARD = texture((x, y) => { const trace = ((y % 16 === 6 && (x + (y >> 4) * 9) % 32 < 22) || (x % 16 === 9 && y % 32 > 6 && y % 32 < 20)) ? 1 : 0; const pad = ((x % 16 === 9 || x % 16 === 10) && (y % 32 === 6 || y % 32 === 20)) ? 1 : 0; const chip = (x > 36 && x < 60 && y > 36 && y < 52) ? 1 : 0; const n = .85 + hash(x, y) * .15; const base = 34 * n; if (chip) return [20, 22, 24]; if (pad) return [200, 170, 90]; if (trace) return [150 * n, 120 * n, 60 * n]; return [base * .7, base * 1.15, base * .8]; });
  const T_RACK = texture((x, y) => { const slot = (y % 16 < 3) ? .45 : 1; const vent = (x % 8 < 4 && y % 16 > 6 && y % 16 < 13) ? .6 : 1; const lamp = (y % 16 === 8 && x % 32 === 26) ? 1 : 0; const n = .9 + hash(x, y) * .1; const base = 44 * n * slot * vent; if (lamp) return hash(x, y * 7) > .5 ? [255, 176, 46] : [90, 220, 140]; return [base * .92, base * .98, base * 1.08]; });
  const T_STATION = texture((x, y) => { const strip = y >= 26 && y <= 37 ? 1 : 0; const n = .8 + hash(x, y) * .2; const base = 40 * n; return strip ? [255, 176 + hash(x, y) * 30, 46] : [base * .95, base * .9, base * .8]; });
  const T_EXIT = texture((x, y) => { const d = Math.abs(x - 32) / 32; const v = 210 - d * 130 + hash(x, y) * 20; return [v, v * .9, v * .7]; });
  const T_FLOOR = texture((x, y) => { const grout = (x % 32 < 2 || y % 32 < 2) ? .45 : 1; const n = .85 + hash(x * 3, y * 5) * .15; const v = 38 * grout * n; return [v * 1.05, v, v * .92]; });
  const T_CEIL = texture((x, y) => { const lamp = (y > 28 && y < 36 && x > 8 && x < 56) ? 1 : 0; const n = .9 + hash(x, y) * .1; const v = 20 * n; return lamp ? [255, 220, 150] : [v, v * 1.05, v * 1.1]; });
  /* era per cell: breadth-first distance from the entrance, cut in thirds; walls take the era of an open neighbour */
  const ERA = new Uint8Array(W * H); { const dist = new Int32Array(W * H).fill(-1), q = [START]; dist[START] = 0; let maxd = 0; while (q.length) { const c = q.shift(); maxd = Math.max(maxd, dist[c]); for (const d of [1, -1, W, -W]) { const n = c + d; if (n >= 0 && n < W * H && MAP[n] === 0 && dist[n] === -1) { dist[n] = dist[c] + 1; q.push(n); } } } for (let c = 0; c < W * H; c++) if (MAP[c] === 0) ERA[c] = dist[c] < maxd / 3 ? 0 : dist[c] < maxd * 2 / 3 ? 1 : 2; for (let c = 0; c < W * H; c++) if (MAP[c] !== 0) { let e = 0, best = -1; for (const d of [1, -1, W, -W]) { const n = c + d; if (n >= 0 && n < W * H && MAP[n] === 0 && dist[n] > best) { best = dist[n]; e = ERA[n]; } } ERA[c] = e; } }
  const ERA_TEX = [T_STEEL, T_BOARD, T_RACK];
  const stationCell = new Set(CP);
  /* which cells are station walls: the walls around a station cell */
  const nearStation = new Set(); for (const c of CP) { const x = c % W, y = (c / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (wall(x + dx, y + dy)) nearStation.add((y + dy) * W + x + dx); }
  const nearExit = new Set(); { const x = EXIT % W, y = (EXIT / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (wall(x + dx, y + dy)) nearExit.add((y + dy) * W + x + dx); }

  /* plaques: one offscreen canvas per station, redrawn once the Pons mark has loaded */
  const PONS = new Image(); PONS.src = '/assets/pons.png';
  function plaque(i) {
    const c = document.createElement('canvas'); c.width = 320; c.height = 200; const g = c.getContext('2d');
    g.fillStyle = '#0c0b09'; g.fillRect(0, 0, 320, 200);
    g.strokeStyle = '#ffb02e'; g.lineWidth = 5; g.strokeRect(8, 8, 304, 184);
    g.strokeStyle = 'rgba(255,176,46,.35)'; g.lineWidth = 1; g.strokeRect(18, 18, 284, 164);
    g.fillStyle = '#ffb02e'; g.fillRect(18, 18, 284, 26);
    g.fillStyle = '#0c0b09'; g.font = 'bold 15px ui-monospace, Menlo, monospace'; g.textAlign = 'left'; g.fillText('STATION ' + String(i + 1).padStart(2, '0') + ' / ' + String(CP.length).padStart(2, '0'), 26, 37);
    g.textAlign = 'right'; g.fillText('AI LABYRINTH', 294, 37);
    g.fillStyle = '#fff2d6'; g.font = 'bold 66px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.fillText(String(LABELS[i]).slice(0, 4), 160, 112);
    g.fillStyle = '#e8e2d2'; g.font = '17px ui-monospace, Menlo, monospace';
    const t = String(LABELS[i]).slice(5), words = t.split(' '), lines = []; let cur = ''; for (const w of words) { if ((cur + ' ' + w).trim().length > 26) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; } lines.push(cur.trim());
    lines.slice(0, 2).forEach((l, k) => g.fillText(l, 160, 140 + k * 22));
    if (PONS.complete && PONS.naturalWidth) { g.globalAlpha = .9; g.drawImage(PONS, 26, 156, 22, 22); g.globalAlpha = 1; g.fillStyle = '#ffb02e'; g.font = 'bold 10px ui-monospace, Menlo, monospace'; g.textAlign = 'left'; g.fillText('PONS · ROBINHOOD CHAIN', 54, 172); }
    return c;
  }
  let PLAQUES = CP.map((_, i) => plaque(i));
  PONS.onload = () => { PLAQUES = CP.map((_, i) => plaque(i)); };
  const EXIT_SIGN = (() => { const c = document.createElement('canvas'); c.width = 320; c.height = 110; const g = c.getContext('2d'); g.fillStyle = '#0c0b09'; g.fillRect(0, 0, 320, 110); g.strokeStyle = '#ffb02e'; g.lineWidth = 5; g.strokeRect(8, 8, 304, 94); g.fillStyle = '#ffb02e'; g.font = 'bold 64px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.fillText('EXIT', 160, 78); return c; })();

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
    /* floor and ceiling cast row by row: tiles below, a lamp strip every cell above, fog toward the horizon */
    const ca0 = Math.cos(S.a), sa0 = Math.sin(S.a), t0 = Math.tan(FOV / 2);
    const rdx0 = ca0 + sa0 * t0, rdy0 = sa0 - ca0 * t0, rdx1 = ca0 - sa0 * t0, rdy1 = sa0 + ca0 * t0;
    for (let y = 0; y < RH; y++) {
      const p = y - half; if (p === 0) continue;
      const rowDist = Math.abs(half / p), fog = Math.max(0, 1 - rowDist / FOG);
      const stepX = rowDist * (rdx1 - rdx0) / RW, stepY = rowDist * (rdy1 - rdy0) / RW;
      let fx = S.x + rowDist * rdx0, fy = S.y + rowDist * rdy0;
      const tex = p > 0 ? T_FLOOR : T_CEIL, shade = fog * (p > 0 ? 1 : .8);
      for (let x = 0; x < RW; x++) {
        const tx = ((fx - Math.floor(fx)) * TS) | 0, ty = ((fy - Math.floor(fy)) * TS) | 0, ti = (ty * TS + tx) * 4, i = (y * RW + x) * 4;
        d[i] = tex[ti] * shade; d[i + 1] = tex[ti + 1] * shade; d[i + 2] = tex[ti + 2] * shade; d[i + 3] = 255;
        fx += stepX; fy += stepY;
      }
    }
    const ca = Math.cos(S.a), sa = Math.sin(S.a), px = -sa * Math.tan(FOV / 2), py = ca * Math.tan(FOV / 2);
    for (let col = 0; col < RW; col++) {
      const cam = 2 * col / RW - 1, rx = ca + px * cam, ry = sa + py * cam;
      let mx = S.x | 0, my = S.y | 0; const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry);
      let sx, sy, sdx, sdy; if (rx < 0) { sx = -1; sdx = (S.x - mx) * ddx; } else { sx = 1; sdx = (mx + 1 - S.x) * ddx; } if (ry < 0) { sy = -1; sdy = (S.y - my) * ddy; } else { sy = 1; sdy = (my + 1 - S.y) * ddy; }
      let side = 0, hit = 0, guard = 0, prevCell = (S.y | 0) * W + (S.x | 0);
      while (!hit && guard++ < 128) { if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; } if (wall(mx, my)) hit = 1; else prevCell = my * W + mx; }
      const dist = side === 0 ? sdx - ddx : sdy - ddy; z[col] = dist;
      const lh = Math.max(1, (RH / Math.max(.05, dist)) | 0), y0 = Math.max(0, (half - lh / 2) | 0), y1 = Math.min(RH - 1, (half + lh / 2) | 0);
      let wx = side === 0 ? S.y + dist * ry : S.x + dist * rx; wx -= Math.floor(wx);
      const cellIdx = my * W + mx, tex = nearExit.has(cellIdx) ? T_EXIT : nearStation.has(cellIdx) ? T_STATION : ERA_TEX[ERA[prevCell]];
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
    ctx.strokeStyle = 'rgba(255,242,214,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(RW / 2 - 4, half); ctx.lineTo(RW / 2 + 4, half); ctx.moveTo(RW / 2, half - 4); ctx.lineTo(RW / 2, half + 4); ctx.stroke();
    /* minimap: only what you have walked */
    const ms = Math.max(2, (RW / 200) | 0), mw = W * ms, ox = RW - mw - 8, oy = 8;
    ctx.fillStyle = 'rgba(12,11,9,.75)'; ctx.fillRect(ox - 3, oy - 3, mw + 6, H * ms + 6);
    for (const c of S.visited) { const x = c % W, y = (c / W) | 0; ctx.fillStyle = stationCell.has(c) ? '#ffb02e' : c === EXIT ? '#fff2d6' : 'rgba(232,226,210,.35)'; ctx.fillRect(ox + x * ms, oy + y * ms, ms, ms); }
    ctx.fillStyle = '#ff5c3a'; ctx.fillRect(ox + (S.x | 0) * ms, oy + (S.y | 0) * ms, ms, ms);
    /* the toast when a station is reached */
    if (S.toast !== null && now - S.toastAt < 3200) { const a = Math.min(1, (3200 - (now - S.toastAt)) / 600); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(12,11,9,.85)'; ctx.fillRect(RW / 2 - 150, RH - 60, 300, 44); ctx.fillStyle = '#ffb02e'; ctx.font = 'bold 12px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; ctx.fillText(LABELS[S.toast], RW / 2, RH - 42); ctx.fillStyle = '#e8e2d2'; ctx.font = '9px ui-monospace, Menlo, monospace'; ctx.fillText((NOTES[S.toast] || '').slice(0, 60), RW / 2, RH - 26); ctx.globalAlpha = 1; }
    if (!S.started) { ctx.fillStyle = 'rgba(12,11,9,.6)'; ctx.fillRect(0, 0, RW, RH); ctx.fillStyle = '#fff2d6'; ctx.font = 'bold 14px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center'; ctx.fillText(isTouch ? 'touch to enter' : 'click to enter', RW / 2, half - 6); ctx.font = '10px ui-monospace, Menlo, monospace'; ctx.fillStyle = 'rgba(232,226,210,.7)'; ctx.fillText(isTouch ? 'left half moves, right half turns' : 'W A S D to move and turn, Q E to strafe, mouse to look', RW / 2, half + 14); }
  }
  let last = performance.now(), raf = 0;
  function loop(now) { const dt = Math.min(.05, (now - last) / 1000); last = now; step(dt); render(now); raf = requestAnimationFrame(loop); }
  raf = requestAnimationFrame(loop);
  const api = { summary, mute(v) { muted = v; }, destroy() { cancelAnimationFrame(raf); } };
  if (hooks.debug) {
    /* development only: time the renderer and jump to a cell, never wired on the public page */
    api.bench = n => { const t = performance.now(); for (let i = 0; i < n; i++) render(performance.now()); return (performance.now() - t) / n; };
    api.jump = (cell, a) => { S.x = (cell % W) + .5; S.y = ((cell / W) | 0) + .5; S.cell = cell; if (a !== undefined) S.a = a; S.started = true; S.t0 = S.t0 || performance.now(); render(performance.now()); };
  }
  return api;
}
