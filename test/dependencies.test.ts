import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicKey, type AccountInfo } from '@solana/web3.js';
import { NATIVE_MINT, MintLayout, AccountLayout } from '@solana/spl-token';
import BN from 'bn.js';

const require = createRequire(import.meta.url);
const sdk = require('@pump-fun/pump-swap-sdk') as typeof import('@pump-fun/pump-swap-sdk');
const bn = (value: bigint | number | string) => new BN(String(value));
const mint = new PublicKey('7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump');

test('content-checked fallback patch is repeatable and native bigint binding stays unloaded', () => {
  execFileSync(process.execPath, ['scripts/patch-bigint-buffer.mjs'], { cwd: fileURLToPath(new URL('../', import.meta.url)) });
  const path = require.resolve('bigint-buffer');
  assert.match(readFileSync(path, 'utf8'), /const converter = undefined;/);
  assert.doesNotMatch(readFileSync(path, 'utf8'), /require\('bindings'\)/);
  const conversions = require('bigint-buffer') as {
    toBufferLE: (n: bigint, width: number) => Buffer; toBufferBE: (n: bigint, width: number) => Buffer;
    toBigIntLE: (b: Buffer) => bigint; toBigIntBE: (b: Buffer) => bigint;
  };
  for (const value of [0n, 1n, 255n, 256n, 0x0102030405060708n, (1n << 64n) - 1n]) {
    const little = conversions.toBufferLE(value, 8);
    const big = conversions.toBufferBE(value, 8);
    const expected = Buffer.alloc(8); expected.writeBigUInt64LE(value);
    assert.deepEqual(little, expected);
    assert.deepEqual(big, Buffer.from(expected).reverse());
    assert.equal(conversions.toBigIntLE(little), value);
    assert.equal(conversions.toBigIntBE(big), value);
  }
  assert.equal(conversions.toBigIntLE(Buffer.alloc(0)), 0n);
  assert.equal(conversions.toBigIntLE(Buffer.from([0xff, 0x01, 0x02])), 0x0201ffn);
  assert.equal(Object.keys(require.cache).some(p => p.endsWith('bigint_buffer.node')), false);
});

test('fallback patch rejects unreviewed version or contents without changing them', () => {
  const root = mkdtempSync(join(tmpdir(), 'poe-dependency-patch-fixture-'));
  try {
    mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'node_modules', 'bigint-buffer', 'dist'), { recursive: true });
    const script = join(root, 'scripts', 'patch-bigint-buffer.mjs');
    copyFileSync(new URL('../scripts/patch-bigint-buffer.mjs', import.meta.url), script);
    const entry = join(root, 'node_modules', 'bigint-buffer', 'dist', 'node.js');
    const manifest = join(root, 'node_modules', 'bigint-buffer', 'package.json');
    const unreviewed = readFileSync(require.resolve('bigint-buffer'), 'utf8') + '\n// unreviewed fixture change\n';
    writeFileSync(entry, unreviewed);
    writeFileSync(manifest, JSON.stringify({ name: 'bigint-buffer', version: '1.1.5', main: 'dist/node.js' }));
    assert.throws(() => execFileSync(process.execPath, [script], { cwd: root, stdio: 'pipe' }), /Command failed/);
    assert.equal(readFileSync(entry, 'utf8'), unreviewed);
    writeFileSync(manifest, JSON.stringify({ name: 'bigint-buffer', version: '1.1.6', main: 'dist/node.js' }));
    assert.throws(() => execFileSync(process.execPath, [script], { cwd: root, stdio: 'pipe' }), /Command failed/);
    assert.equal(readFileSync(entry, 'utf8'), unreviewed);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('SPL u64 mint/account layouts retain integer values with JS fallback', () => {
  const data = Buffer.alloc(MintLayout.span);
  data.writeBigUInt64LE((1n << 64n) - 1n, 36); data[44] = 6; data[45] = 1;
  assert.equal(MintLayout.decode(data).supply, (1n << 64n) - 1n);
  const account = Buffer.alloc(AccountLayout.span);
  account.writeBigUInt64LE(0x0102030405060708n, 64);
  assert.equal(AccountLayout.decode(account).amount, 0x0102030405060708n);
});

test('current SDK CommonJS entry preserves known canonical PDA and versioned signed pool decoding', () => {
  assert.equal(sdk.canonicalPumpPoolPda(mint).toBase58(), 'GseMAnNDvntR5uFePZ51yZBXzNSn7GdFPkfHwfr6d77J');
  assert.equal(sdk.pumpPoolAuthorityPda(mint).toBase58(), '9XDYTfQKwW8sHPqnFdUreMmtmffmkHVPGTNV2e3LKxNW');
  // Disposable bytes from the public IDL layout, not captured on-chain evidence.
  const data = Buffer.alloc(287);
  createHash('sha256').update('account:Pool').digest().copy(data, 0, 0, 8);
  sdk.pumpPoolAuthorityPda(mint).toBuffer().copy(data, 11);
  mint.toBuffer().copy(data, 43); NATIVE_MINT.toBuffer().copy(data, 75);
  sdk.lpMintPda(sdk.canonicalPumpPoolPda(mint)).toBuffer().copy(data, 107);
  data.writeBigUInt64LE(123n, 203);
  const signed = -5_000_000_000n;
  Buffer.from(BigInt.asUintN(128, signed).toString(16).padStart(32, '0'), 'hex').reverse().copy(data, 245);
  data.writeBigUInt64LE(4_000_000_000n, 271); data.writeBigUInt64LE(1_000_000_000n, 279);
  const account: AccountInfo<Buffer> = { data, owner: sdk.PUMP_AMM_PROGRAM_ID, lamports: 1, executable: false, rentEpoch: 0 };
  const pool = sdk.PUMP_AMM_SDK.decodePool(account);
  assert.equal(pool.virtualQuoteReserves.toString(), String(signed));
  assert.equal(pool.protocolFees.add(pool.creatorFees).toString(), '5000000000');
  assert.equal(pool.lpSupply.toString(), '123');
  assert.ok(pool.baseMint.equals(mint));
  const old = sdk.PUMP_AMM_SDK.decodePool({ ...account, data: data.subarray(0, 211) });
  assert.equal(old.virtualQuoteReserves.toString(), '0');
  assert.equal(old.protocolFees.toString(), '0');
});

test('SDK quotes retain signed effective reserves, dynamic fee tier and ceil/floor behavior', () => {
  const tier = { lpFeeBps: bn(20), protocolFeeBps: bn(5), creatorFeeBps: bn(30) };
  const config = {
    lpFeeBasisPoints: bn(999), protocolFeeBasisPoints: bn(999), coinCreatorFeeBasisPoints: bn(999), creatorFeeConfigurable: false,
  } as import('@pump-fun/pump-swap-sdk').GlobalConfig;
  const feeConfig = { admin: PublicKey.default, flatFees: tier, feeTiers: [{ marketCapLamportsThreshold: bn(0), fees: tier }], stableFeeTiers: [], exoticFlatFees: tier } as import('@pump-fun/pump-swap-sdk').FeeConfig;
  const mintBytes = Buffer.alloc(MintLayout.span); mintBytes.writeBigUInt64LE(1_000_000_000_000_000n, 36);
  const opts = {
    baseReserve: bn(1_000_000_000_000n), quoteReserve: bn(100_000_000_000n), virtualQuoteReserves: bn(-5_000_000_000n),
    feeBucketsTotal: bn(5_000_000_000n), globalConfig: config, feeConfig,
    baseMintAccount: MintLayout.decode(mintBytes), baseMint: mint, creator: sdk.pumpPoolAuthorityPda(mint),
    coinCreator: new PublicKey('5L5k7gtNLbeXdzpvNrFshg1E1id1ceUDfc6vPUTxp98q'), quoteMint: NATIVE_MINT, slippage: 0,
  };
  const buy = sdk.buyQuoteInput({ ...opts, quote: bn(10_000_000) });
  assert.equal(buy.base.toString(), '104676399');
  assert.equal(buy.internalQuoteWithoutFees.toString(), '9945300');
  const sell = sdk.sellBaseInput({ ...opts, base: buy.base });
  // Independent integer calculation: output floors, then each fee rounds up.
  const gross = 95_000_000_000n * 104_676_399n / (1_000_000_000_000n + 104_676_399n);
  const ceilFee = (bps: bigint) => (gross * bps + 9_999n) / 10_000n;
  assert.equal(sell.internalQuoteAmountOut.toString(), String(gross));
  assert.equal(sell.uiQuote.toString(), String(gross - ceilFee(20n) - ceilFee(5n) - ceilFee(30n)));
  assert.equal(sell.uiQuote.toString(), '9888528');
  assert.throws(() => sdk.sellBaseInput({ ...opts, feeBucketsTotal: opts.quoteReserve, base: buy.base }), /real quote reserves/);
  assert.ok(sdk.buyQuoteInput({ ...opts, virtualQuoteReserves: bn(0), quote: bn(10_000_000) }).base.lt(buy.base));
});

test('scoped Jayson upgrade retains web3 browser-client request/callback interface', async () => {
  const web3Require = createRequire(require.resolve('@solana/web3.js'));
  const Client = web3Require('jayson/lib/client/browser');
  const version = web3Require('jayson/package.json').version;
  assert.equal(version, '5.0.0');
  await new Promise<void>((resolve, reject) => {
    const client = new Client((body: string, callback: (e: unknown, r: string) => void) => {
      const request = JSON.parse(body);
      assert.equal(request.method, 'getSlot'); assert.deepEqual(request.params, []);
      callback(null, JSON.stringify({ jsonrpc: '2.0', id: request.id, result: 4242 }));
    });
    client.request('getSlot', [], 'poe-dependency-fixture', (error: unknown, response: { id: string; result: number }) => {
      try { assert.equal(error, null); assert.equal(response.id, 'poe-dependency-fixture'); assert.equal(response.result, 4242); resolve(); }
      catch (e) { reject(e); }
    });
  });
});

test('scoped TOML upgrade preserves Anchor local configuration parsing', () => {
  const anchorRequire = createRequire(require.resolve('@coral-xyz/anchor'));
  assert.equal(anchorRequire('toml/package.json').version, '5.0.1');
  const parsed = anchorRequire('toml').parse('[provider]\ncluster = "mainnet"\nwallet = "fixture-never-loaded.json"\n[programs.mainnet]\npoe_fixture = "11111111111111111111111111111111"\n');
  assert.equal(parsed.provider.cluster, 'mainnet');
  assert.equal(parsed.programs.mainnet.poe_fixture, '11111111111111111111111111111111');
});
