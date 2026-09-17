/* Reads the labyrinth from the contract through the public RPCs. Until the contract is deployed the site reads the
   same bytes from assets/maze.json and says so; the notes under each station only live in that file. */
import { parseAbi, hexToBytes } from 'https://cdn.jsdelivr.net/npm/viem@2.21.55/+esm';
import { pubs } from './wallet.js';

export const CHAIN = 4663;
export const pub = pubs[CHAIN];
export const LABYRINTH = /^0x[0-9a-fA-F]{40}$/.test(window.AIRUN_LABYRINTH || '') ? window.AIRUN_LABYRINTH : null;
export const ABI = parseAbi([
  'function board() view returns (uint8 w, uint8 h, uint16 s, uint16 e, bytes m, uint16[] cells, string[] labels, uint256 nRuns, uint32 record, address holder)',
  'function verify(bytes moves) view returns (bool ok, uint32 steps, uint8 reached, uint16 stopped)',
  'function submit(bytes moves) returns (uint256)',
  'function runs(uint256 from, uint256 n) view returns ((address runner, uint32 steps, uint64 time)[])',
  'function runCount() view returns (uint256)',
  'function bestSteps(address) view returns (uint32)',
  'function finishes(address) view returns (uint32)',
  'function recordSteps() view returns (uint32)',
  'function recordHolder() view returns (address)',
  'error Rejected(uint32 steps, uint8 reached, uint16 stopped)',
  'event Finished(address indexed runner, uint32 steps, uint256 indexed index, bool personalBest, bool record)'
]);

export async function loadBoard() {
  const local = await fetch('/assets/maze.json').then(r => r.json());
  const notes = local.stations.map(s => s.note);
  if (!LABYRINTH) {
    return { source: 'file', w: local.w, h: local.h, start: local.start, exit: local.exit, map: hexToBytes(local.map), checkpoints: local.checkpoints, labels: local.stations.map(s => s.year + ' ' + s.title), notes, nRuns: 0, record: 0, holder: null };
  }
  const b = await pub.readContract({ address: LABYRINTH, abi: ABI, functionName: 'board' });
  const [w, h, s, e, m, cells, labels, nRuns, record, holder] = b;
  return { source: 'chain', w: Number(w), h: Number(h), start: Number(s), exit: Number(e), map: hexToBytes(m), checkpoints: cells.map(Number), labels: [...labels], notes, nRuns: Number(nRuns), record: Number(record), holder: holder === '0x0000000000000000000000000000000000000000' ? null : holder };
}

export const movesHex = moves => '0x' + moves.map(m => m.toString(16).padStart(2, '0')).join('');

export async function askChain(moves) {
  if (!LABYRINTH) return null;
  const [ok, steps, reached, stopped] = await pub.readContract({ address: LABYRINTH, abi: ABI, functionName: 'verify', args: [movesHex(moves)] });
  return { ok, steps: Number(steps), reached: Number(reached), stopped: Number(stopped) };
}

export async function loadRuns(n = 50) {
  if (!LABYRINTH) return [];
  const count = await pub.readContract({ address: LABYRINTH, abi: ABI, functionName: 'runCount' });
  if (count === 0n) return [];
  const from = count > BigInt(n) ? count - BigInt(n) : 0n;
  const rs = await pub.readContract({ address: LABYRINTH, abi: ABI, functionName: 'runs', args: [from, BigInt(n)] });
  return rs.map((r, i) => ({ index: Number(from) + i, runner: r.runner, steps: Number(r.steps), time: Number(r.time) })).reverse();
}

export const ago = ts => { const s = Math.floor(Date.now() / 1000) - ts; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
export const clock = s => { s = Math.floor(s); return (Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0'); };
