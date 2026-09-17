/* AI Labyrinth against a fork of Robinhood Chain mainnet (ethereumjs VM + RPCStateManager): the real Pons V2 factory,
   curve and fee escrow. Backers fund a goal, the coin launches on Pons with the first buy in the same transaction,
   the chest defends the opening level. No real keys are involved. */
import fs from 'node:fs';
import path from 'node:path';
import { VM } from '@ethereumjs/vm';
import { RPCStateManager } from '@ethereumjs/statemanager';
import { Common, Hardfork } from '@ethereumjs/common';
import { Block } from '@ethereumjs/block';
import { Address, Account, bytesToHex, hexToBytes } from '@ethereumjs/util';
import { encodeFunctionData, decodeFunctionResult, decodeErrorResult, decodeEventLog, encodeDeployData, parseAbi, formatEther, getAddress } from 'viem';

const RPC = 'https://robinhood-rpc.publicnode.com';
const realFetch = globalThis.fetch;
let rpcRetries = 0, rpcCalls = 0;
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith(RPC)) return realFetch(url, opts);
  rpcCalls++;
  let last;
  for (let i = 0; i < 8; i++) {
    try { const text = await (await realFetch(url, opts)).text(); const j = JSON.parse(text); if (j.result !== undefined) return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } }); last = JSON.stringify(j.error || j); } catch (e) { last = e.message; }
    rpcRetries++;
    await new Promise(r => setTimeout(r, 250 * 2 ** i));
  }
  throw Error('RPC failed: ' + last);
};

const dir = path.dirname(new URL(import.meta.url).pathname);
const art = n => JSON.parse(fs.readFileSync(path.join(dir, 'artifacts', n + '.json'), 'utf8'));
const LB = art('Labyrinth');
const ALL = [...LB.abi, ...parseAbi(['error E(string)'])].filter((x, i, a) => x.type !== 'event' || a.findIndex(y => y.type === 'event' && y.name === x.name) === i);
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)']);
const PONS = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e', ESCROW = '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e', DEAD = '0x000000000000000000000000000000000000dEaD', ZERO = '0x0000000000000000000000000000000000000000';
const E = n => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
const addr = n => getAddress('0x' + n.toString(16).padStart(40, '0'));
let pass = 0, fail = 0;
const ok = (c, label, extra = '') => { if (c) pass++; else { fail++; console.log('  FAIL', label, extra); } };

class ForkState extends RPCStateManager {
  constructor(o) { super(o); this._codeStack = []; }
  async checkpoint() { await super.checkpoint(); this._codeStack.push(new Map(this._contractCache)); }
  async commit() { this._accountCache.commit(); this._storageCache.commit(); this._codeStack.pop(); }
  async revert() { this._accountCache.revert(); this._storageCache.revert(); const snap = this._codeStack.pop(); if (snap) this._contractCache = snap; }
}
const head = (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }) })).json()).result;
const common = Common.custom({ chainId: 4663, networkId: 4663 }, { hardfork: Hardfork.Cancun });
const stateManager = new ForkState({ provider: RPC, blockTag: BigInt(head.number) });
stateManager._blockTag = 'latest';
const vm = await VM.create({ common, stateManager });
let now = BigInt(head.timestamp) + 12n;
const block = () => Block.fromBlockData({ header: { number: BigInt(head.number) + 1n, timestamp: now, gasLimit: 30_000_000n, baseFeePerGas: 0n } }, { common });

async function exec(from, to, data, value = 0n) {
  const r = await vm.evm.runCall({ caller: Address.fromString(from), to: to ? Address.fromString(to) : undefined, data: hexToBytes(data), gasLimit: 30_000_000n, value, block: block() });
  const e = r.execResult; let reason = null;
  if (e.exceptionError) { try { const d = decodeErrorResult({ abi: ALL, data: bytesToHex(e.returnValue) }); reason = d.args ? String(d.args[0]) : d.errorName; } catch { reason = e.exceptionError.error + ' ' + bytesToHex(e.returnValue).slice(0, 80); } }
  const logs = (e.logs || []).map(([a, topics, d]) => { try { return { address: getAddress(bytesToHex(a)), ...decodeEventLog({ abi: ALL, topics: topics.map(bytesToHex), data: bytesToHex(d) }) }; } catch { return null; } }).filter(Boolean);
  return { reverted: !!e.exceptionError, reason, logs, ret: bytesToHex(e.returnValue), gas: e.executionGasUsed, created: r.createdAddress ? getAddress(r.createdAddress.toString()) : null };
}
async function tx(from, to, abi, functionName, args = [], value = 0n) {
  const r = await exec(from, to, encodeFunctionData({ abi, functionName, args }), value);
  if (!r.reverted) try { r.result = decodeFunctionResult({ abi, functionName, data: r.ret }); } catch {}
  return r;
}
async function must(from, to, abi, fn, args, label, value = 0n) { const r = await tx(from, to, abi, fn, args, value); ok(!r.reverted, label, r.reason || ''); return r; }
async function reverts(from, to, abi, fn, args, expect, label, value = 0n) { const r = await tx(from, to, abi, fn, args, value); ok(r.reverted && (!expect || String(r.reason).includes(expect)), label, `reverted=${r.reverted} reason=${r.reason}`); }
const view = async (to, abi, fn, args = []) => { const r = await tx(addr(1), to, abi, fn, args); if (r.reverted) throw Error(fn + ' reverted: ' + r.reason); return r.result; };
const giveEth = async (who, wei) => { const a = Address.fromString(who), acct = (await vm.stateManager.getAccount(a)) ?? new Account(); acct.balance = wei; await vm.stateManager.putAccount(a, acct); };
const ethBal = async who => (await vm.stateManager.getAccount(Address.fromString(who)))?.balance ?? 0n;
const bal = (token, who) => view(token, ERC20, 'balanceOf', [who]);
async function deploy(from, a, args = []) {
  const r = await exec(from, null, args.length ? encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args }) : a.bytecode);
  if (r.reverted) throw Error('deploy failed ' + a.contractName + ' ' + r.reason);
  const who = Address.fromString(from), acct = (await vm.stateManager.getAccount(who)) ?? new Account();
  acct.nonce += 1n; await vm.stateManager.putAccount(who, acct);
  return r.created;
}


import { generate, STATIONS, draw } from './maze.mjs';
const guardian = addr(0xd0), alice = addr(0xa1), bob = addr(0xb0), eve = addr(0xee);
for (const w of [guardian, alice, bob, eve]) await giveEth(w, E(1));
const M = generate();
const hex = '0x' + Buffer.from(M.grid).toString('hex');
const labels = STATIONS.map(s => s.year + ' ' + s.title);
console.log('fork block', Number(head.number), `· labyrinth ${LB.deployedSize} bytes · maze ${M.w}x${M.h}, path ${M.moves.length} moves`);

// ------------------------------------------------------------------ deploy
await (async () => { const bad = new Uint8Array(M.grid); bad[M.start] = 1; const r = await exec(guardian, null, encodeDeployData({ abi: LB.abi, bytecode: LB.bytecode, args: [M.w, M.h, M.start, M.exit, '0x' + Buffer.from(bad).toString('hex'), M.checkpoints, labels] })); ok(r.reverted && String(r.reason).includes('start or exit'), 'a maze whose start is a wall is refused'); })();
const L = await deploy(guardian, LB, [M.w, M.h, M.start, M.exit, hex, M.checkpoints, labels]);
const board = await view(L, LB.abi, 'board');
ok(board[0] === M.w && board[1] === M.h && board[2] === M.start && board[3] === M.exit && board[4] === hex, 'board() returns the maze as deployed');
ok(board[5].length === 12 && board[6][1] === '1956 Dartmouth gives it a name', 'twelve stations with their labels');
const st = await view(L, LB.abi, 'stations');
ok(st[0].every((c, i) => c === M.checkpoints[i]), 'stations in path order');

// ------------------------------------------------------------------ the judge
const hexMoves = a => '0x' + Buffer.from(a).toString('hex');
const good = hexMoves(M.moves);
let v = await view(L, LB.abi, 'verify', [good]);
ok(v[0] === true && v[1] === M.moves.length && v[2] === 12 && v[3] === M.exit, 'the solution verifies: all stations, exit reached', JSON.stringify(v.map(String)));
v = await view(L, LB.abi, 'verify', [hexMoves(M.moves.slice(0, -1))]);
ok(v[0] === false && v[2] === 12 && v[3] !== M.exit, 'one step short: stations passed but not at the exit');
v = await view(L, LB.abi, 'verify', [hexMoves([2])]);
ok(v[0] === false && v[1] === 0 && v[3] === M.start + M.w, 'a step into a wall stops the walk at that wall');
v = await view(L, LB.abi, 'verify', [hexMoves([0])]);
ok(v[0] === false && v[1] === 0, 'a step off the edge is refused');
v = await view(L, LB.abi, 'verify', [hexMoves([7])]);
ok(v[0] === false, 'an unknown move is refused');
v = await view(L, LB.abi, 'verify', ['0x']);
ok(v[0] === false, 'an empty run is refused');
/* a detour: walk into a dead end and back, then the solution. more steps, still valid */
const first = M.moves[0], back = (first + 2) % 4;
const detour = hexMoves([first, back, ...M.moves]);
v = await view(L, LB.abi, 'verify', [detour]);
ok(v[0] === true && v[1] === M.moves.length + 2, 'a detour still finishes, with more steps');
/* teleport attempt: start the solution from the second cell (skips the first move) */
v = await view(L, LB.abi, 'verify', [hexMoves(M.moves.slice(1))]);
ok(v[0] === false, 'a run that does not start at the entrance fails');
const tooLong = hexMoves(Array(6001).fill(first % 2 ? 1 : 2));
v = await view(L, LB.abi, 'verify', [tooLong]);
ok(v[0] === false, 'a run over 6000 moves is refused');

// ------------------------------------------------------------------ submitting
const s1 = await must(alice, L, LB.abi, 'submit', [detour], 'alice submits a run with a detour');
const f1 = s1.logs.find(l => l.eventName === 'Finished');
ok(f1 && f1.args.runner === alice && f1.args.steps === M.moves.length + 2 && f1.args.personalBest && f1.args.record, 'first finish is a personal best and the record');
console.log('  submit gas', s1.gas, '· steps', f1 && f1.args.steps);
const s2 = await must(bob, L, LB.abi, 'submit', [good], 'bob submits the clean solution');
const f2 = s2.logs.find(l => l.eventName === 'Finished');
ok(f2 && f2.args.record && (await view(L, LB.abi, 'recordHolder')) === bob && (await view(L, LB.abi, 'recordSteps')) === M.moves.length, 'bob takes the record with fewer steps');
const s3 = await must(alice, L, LB.abi, 'submit', [good], 'alice runs again, clean');
const f3 = s3.logs.find(l => l.eventName === 'Finished');
ok(f3 && f3.args.personalBest && !f3.args.record, 'a tie is a personal best but not a new record');
ok((await view(L, LB.abi, 'bestSteps', [alice])) === M.moves.length && (await view(L, LB.abi, 'finishes', [alice])) === 2, 'alice: best steps and two finishes');
const rj = await tx(eve, L, LB.abi, 'submit', [hexMoves(M.moves.slice(0, -1))]);
ok(rj.reverted && rj.reason !== null, 'an unfinished run is rejected with Rejected(steps, reached, stopped)', rj.reason);
ok((await view(L, LB.abi, 'runCount')) === 3n, 'three runs recorded');
const rs = await view(L, LB.abi, 'runs', [0n, 10n]);
ok(rs.length === 3 && rs[1].runner === bob && rs[1].steps === M.moves.length, 'runs() lists them in order');
const names = LB.abi.filter(x => x.type === 'function').map(x => x.name);
ok(!names.some(n => /withdraw|owner|set|pause|rescue/i.test(n)), 'no owner, no setters, nothing to withdraw');

console.log(`\n${pass} passed, ${fail} failed · rpc retries ${rpcRetries} · rpc calls ${rpcCalls}`);
process.exit(fail ? 1 : 0);
