import { existsSync, readFileSync, statSync, chmodSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { PaperLedger, type LedgerMode, type LedgerState, type Mark, type RuntimeReadiness, type UsdPrice } from './ledger.js';

type Input = { price?: UsdPrice; marks?: Record<string, Mark>; readiness?: RuntimeReadiness; reason?: string; gasReserve?: string };
function privateParent(path: string) {
  const parent = dirname(path); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const st = statSync(parent);
  if (st.uid !== process.getuid?.() || st.mode & 0o077) throw new Error('account directory must be owner-held with mode 0700');
}
function privateFile(path: string) {
  const st = statSync(path);
  if (!st.isFile() || st.uid !== process.getuid?.() || st.mode & 0o077) throw new Error('financial file must be owner-held with mode 0600');
}
function jsonInput(path?: string): Input {
  if (!path) return {};
  const st = statSync(path); if (!st.isFile() || st.size > 65_536) throw new Error('bounded input file required');
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('input object required');
  return value as Input;
}
/** Consistent SQLite backup to a NEW target; never overwrite an existing financial copy. */
async function restore(source: string, target: string, accountId: string, mode: LedgerMode, now: number) {
  if (existsSync(target)) throw new Error('restore target must not exist');
  privateFile(source); privateParent(target);
  const db = new Database(source, { readonly: true, fileMustExist: true, timeout: 100 });
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('backup integrity failure');
    const row = db.prepare('SELECT body FROM financial_state WHERE singleton=1').get() as { body: string } | undefined;
    if (!row) throw new Error('backup account not initialized');
    const state = JSON.parse(row.body) as LedgerState;
    if (state.accountId !== accountId || state.mode !== mode) throw new Error('wrong restore account/mode');
    await db.backup(target); chmodSync(target, 0o600);
  } finally { db.close(); }
  const restored = new PaperLedger(target, accountId, mode);
  try {
    if (restored.integrity() !== 'ok') throw new Error('restored account integrity failure');
    const before = restored.state();
    restored.pause(`restore-close-entries:${before.revision + 1}`, Math.max(now, before.lastAt), 'restored account requires fresh runtime reconciliation and readiness');
    return { restored: true, accountId, mode, inceptionAt: restored.state().inceptionAt, entriesEnabled: false, nextStep: 'Start runtime with entries closed; fresh reconciliation and readiness are required.' };
  } finally { restored.close(); }
}

/** Offline operator adapter. A running daemon owns the DB; use its local controls instead. */
export async function runAccountCommand(argv: string[], wallNow = Date.now()): Promise<unknown> {
  const command = argv[0];
  const allowed = new Set(['init','status','pause','resume','safe-stop','backup','restore']);
  if (!command || !allowed.has(command)) throw new Error('command required: init|status|pause|resume|safe-stop|backup|restore');
  const flags = new Map<string,string>();
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!key || !['--db','--account','--mode','--input','--id','--target','--now'].includes(key) || !value || value.startsWith('--') || flags.has(key)) throw new Error('invalid or duplicate command argument');
    flags.set(key, value);
  }
  const dbArg = flags.get('--db'), accountId = flags.get('--account');
  if (!dbArg || !accountId) throw new Error('--db and --account required');
  const path = resolve(dbArg), modeArg = flags.get('--mode') ?? 'PAPER';
  if (modeArg !== 'PAPER' && modeArg !== 'DISPOSABLE_PAPER') throw new Error('explicit PAPER or DISPOSABLE_PAPER mode required');
  const mode = modeArg as LedgerMode;
  const now = flags.has('--now') ? Date.parse(flags.get('--now')!) : wallNow;
  if (!Number.isSafeInteger(now)) throw new Error('valid command time required');
  if (command === 'restore') {
    const source = flags.get('--input'); if (!source) throw new Error('--input backup file required');
    return restore(resolve(source), path, accountId, mode, now);
  }
  if (command === 'init') privateParent(path);
  else if (!existsSync(path)) throw new Error('account database not found; status never initializes it');
  if (existsSync(path)) privateFile(path);
  const ledger = new PaperLedger(path, accountId, mode);
  chmodSync(path, 0o600);
  try {
    const input = jsonInput(flags.get('--input'));
    if (command === 'init') {
      if (!input.price) throw new Error('explicit timestamped USD-to-SOL conversion input required');
      const state = ledger.initialize(input.price, now, input.gasReserve);
      return { initialized: true, accountId: state.accountId, mode: state.mode, inceptionAt: state.inceptionAt, initialMicroUsd: state.initialMicroUsd, cashLamports: state.lamports, entriesEnabled: ledger.projection(now, input.price, input.marks).entriesEnabled };
    }
    if (command === 'status') return { ...ledger.projection(now, input.price, input.marks), liveTrading: false };
    if (command === 'backup') {
      const targetArg = flags.get('--target'); if (!targetArg) throw new Error('--target required');
      const target = resolve(targetArg); if (existsSync(target)) throw new Error('backup target must not exist');
      privateParent(target); await ledger.backup(target); chmodSync(target, 0o600);
      return { backedUp: true, accountId, mode, inceptionAt: ledger.state().inceptionAt };
    }
    const id = flags.get('--id'); if (!id) throw new Error('--id required for idempotent control action');
    if (command === 'pause') return ledger.pause(id, now, input.reason);
    if (command === 'safe-stop') return ledger.safeStop(id, now);
    // This command cannot synthesize runtime readiness; caller must provide the
    // actual bounded source evidence. Observation-only runtimes refuse resume.
    if (!input.price || !input.readiness) throw new Error('resume requires fresh reconciliation and actual runtime readiness; no force option');
    return ledger.resume(id, now, input.price, input.marks ?? {}, input.readiness);
  } finally { ledger.close(); }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  process.umask(0o077);
  try { process.stdout.write(JSON.stringify(await runAccountCommand(process.argv.slice(2))) + '\n'); }
  catch (e) { process.stderr.write((e instanceof Error ? e.message : 'account command failed') + '\n'); process.exitCode = 1; }
}
