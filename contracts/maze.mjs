/* The labyrinth itself: a perfect maze on a 31 x 31 grid carved by a seeded backtracker, so the path from the
   entrance to the exit is unique and the twelve stations placed along it can only be reached in order.
   The same bytes go into the contract constructor and into the site; the contract is the source of truth.
   node maze.mjs           prints a summary and writes maze.json
   node maze.mjs --draw    also prints the maze as text */
import fs from 'node:fs';
import path from 'node:path';

export const W = 31, H = 31, SEED = 1956;
export const STATIONS = [
  { year: 1950, title: 'Turing asks the question', note: 'Computing Machinery and Intelligence, the imitation game' },
  { year: 1956, title: 'Dartmouth gives it a name', note: 'McCarthy, Minsky, Shannon, Rochester; 7,500 dollars for a summer' },
  { year: 1958, title: 'The perceptron learns', note: 'Rosenblatt\'s machine adjusts its own weights' },
  { year: 1966, title: 'ELIZA answers back', note: 'Weizenbaum\'s script that people confided in' },
  { year: 1973, title: 'The Lighthill report', note: 'Funding cut; the first winter begins' },
  { year: 1986, title: 'Backpropagation spreads', note: 'Rumelhart, Hinton, Williams; deep nets can be trained' },
  { year: 1997, title: 'Deep Blue beats Kasparov', note: 'A machine wins a chess match against the world champion' },
  { year: 2012, title: 'AlexNet wins ImageNet', note: 'A GPU-trained convolutional net halves the error rate' },
  { year: 2016, title: 'AlphaGo beats Lee Sedol', note: 'Four games to one; move 37' },
  { year: 2017, title: 'Attention is all you need', note: 'The transformer; every large model since is one' },
  { year: 2020, title: 'GPT-3', note: '175 billion parameters; few-shot prompting' },
  { year: 2022, title: 'ChatGPT', note: 'A hundred million people talk to a model in two months' }
];

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function generate(seed = SEED) {
  const rand = rng(seed);
  const grid = new Uint8Array(W * H).fill(1);
  const at = (x, y) => y * W + x;
  const stack = [[1, 1]]; grid[at(1, 1)] = 0;
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const opts = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1 && grid[at(nx, ny)] === 1);
    if (!opts.length) { stack.pop(); continue; }
    const [nx, ny] = opts[Math.floor(rand() * opts.length)];
    grid[at((x + nx) / 2, (y + ny) / 2)] = 0; grid[at(nx, ny)] = 0; stack.push([nx, ny]);
  }
  const start = at(1, 1), exit = at(W - 2, H - 2);
  /* the unique path, by breadth-first search */
  const prev = new Int16Array(W * H).fill(-1), q = [start]; prev[start] = start;
  while (q.length) { const c = q.shift(); if (c === exit) break; for (const d of [1, -1, W, -W]) { const n = c + d; if (grid[n] === 0 && prev[n] === -1) { prev[n] = c; q.push(n); } } }
  const pathCells = []; for (let c = exit; c !== start; c = prev[c]) pathCells.unshift(c); pathCells.unshift(start);
  /* twelve stations spread along the path, never on the first or last cell */
  const n = STATIONS.length, checkpoints = [];
  for (let i = 0; i < n; i++) checkpoints.push(pathCells[Math.round((i + 1) * (pathCells.length - 1) / (n + 1))]);
  const moves = []; for (let i = 1; i < pathCells.length; i++) { const d = pathCells[i] - pathCells[i - 1]; moves.push(d === 1 ? 1 : d === -1 ? 3 : d === W ? 2 : 0); }
  return { w: W, h: H, seed, grid, start, exit, pathCells, checkpoints, moves };
}

export function draw(m) {
  const cp = new Set(m.checkpoints); let out = '';
  for (let y = 0; y < m.h; y++) { let row = ''; for (let x = 0; x < m.w; x++) { const c = y * m.w + x; row += m.grid[c] ? '##' : c === m.start ? 'S ' : c === m.exit ? 'E ' : cp.has(c) ? (m.checkpoints.indexOf(c) + 1).toString(16).toUpperCase().padEnd(2) : '  '; } out += row + '\n'; }
  return out;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const m = generate();
  const hex = '0x' + Buffer.from(m.grid).toString('hex');
  const json = { w: m.w, h: m.h, seed: m.seed, start: m.start, exit: m.exit, checkpoints: m.checkpoints, stations: STATIONS, map: hex, solutionMoves: m.moves.length, pathCells: m.pathCells.length };
  fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'maze.json'), JSON.stringify(json, null, 2));
  console.log(`maze ${m.w}x${m.h} seed ${m.seed} · path ${m.pathCells.length} cells · ${m.moves.length} moves · stations at`, m.checkpoints.join(' '));
  if (process.argv.includes('--draw')) console.log(draw(m));
}
