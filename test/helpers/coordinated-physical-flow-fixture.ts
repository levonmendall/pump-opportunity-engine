/** OFFLINE transport fixture. PilotNativeFlow owns the real subscription,
 * retirement and ACK state machine. A local socket supplies declared responses;
 * there is no provider connection. Pool support and economic notifications are
 * explicitly synthetic and are supplied by the enclosing coordinated replay. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { PublicKey } from '@solana/web3.js';
import { PilotNativeFlow, type PilotNativeFlowOptions } from '../../src/pilot-native-flow.js';
import { canonicalPumpPoolPda } from '../../src/sdk.js';
import type { PilotRpc, PilotRpcCallOptions } from '../../src/pilot-rpc.js';
import { wsWire } from '../ws-wire-fixture.js';

type WireRequest = { jsonrpc: '2.0'; id: number; method: 'logsSubscribe' | 'logsUnsubscribe'; params: unknown[] };

export function coordinatedPhysicalFlowFixture(input: {
    now: () => number;
    slot: () => number;
    rpc: () => Pick<PilotRpc, 'call' | 'operateData' | 'accountControlBytes' | 'noteThrottle' | 'cooldownUntil' | 'controlCooldownUntil'>;
    callbacks: Pick<PilotNativeFlowOptions, 'record' | 'onFlowOpen' | 'onSubscriptionSent' | 'onCurrentPoolValidated' | 'onGap'>;
}) {
    let holdUnsubscribe = false, pendingUnsubscribe: { socket: Socket; request: WireRequest } | null = null;
    let timerSequence = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    const sent: Array<{ at: number; request: WireRequest }> = [];
    const supports: Array<{ at: number; mints: string[] }> = [];
    class Socket extends EventEmitter {
        readonly _receiver = { writableLength: 0, _state: 0, _bufferedBytes: 0, _fragmented: 0 };
        readonly _socket = Object.assign(new EventEmitter(), { bytesRead: 200 });
        readonly _sender = { sendFrame: (_parts: Buffer[], callback?: () => void) => callback?.() };
        readyState: number = WebSocket.CONNECTING;
        private subscription = 100;
        open() { this.readyState = WebSocket.OPEN; this.emit('open'); }
        frame(value: unknown) {
            assert.equal(this.readyState, WebSocket.OPEN);
            const raw = Buffer.from(JSON.stringify(value));
            this._socket.bytesRead += raw.length + 4;
            this._socket.emit('data', wsWire(raw));
            this.emit('message', raw);
        }
        acknowledge(request: WireRequest) {
            this.frame({ jsonrpc: '2.0', id: request.id, result: request.method === 'logsSubscribe' ? ++this.subscription : true });
        }
        send(data: string, callback?: (error?: Error) => void) {
            const request = JSON.parse(data) as WireRequest;
            assert.equal(request.jsonrpc, '2.0');
            assert.ok(['logsSubscribe', 'logsUnsubscribe'].includes(request.method));
            sent.push({ at: input.now(), request: structuredClone(request) });
            callback?.(); // A successful write alone must not free a retiring slot.
            if (request.method === 'logsUnsubscribe' && holdUnsubscribe) {
                assert.equal(pendingUnsubscribe, null);
                holdUnsubscribe = false;
                pendingUnsubscribe = { socket: this, request };
            } else queueMicrotask(() => this.acknowledge(request));
        }
        ping(payload: Buffer, _mask?: unknown, callback?: (error?: Error) => void) {
            this._sender.sendFrame([Buffer.from([0x89]), payload]);
            callback?.();
            queueMicrotask(() => {
                this._socket.bytesRead += payload.length + 2;
                this._socket.emit('data', wsWire(payload, 10));
                this.emit('pong', Buffer.from(payload));
            });
        }
        pong(payload: Buffer, _mask?: unknown, callback?: (error?: Error) => void) {
            this._sender.sendFrame([Buffer.from([0x8a]), payload]);
            callback?.();
        }
        close(code = 1000) {
            this._sender.sendFrame([Buffer.from([0x88])]);
            this.readyState = WebSocket.CLOSING;
            queueMicrotask(() => this.drop(code));
        }
        terminate() {
            if (this.readyState === WebSocket.CLOSED) return;
            this.readyState = WebSocket.CLOSING;
            queueMicrotask(() => this.drop(1006));
        }
        drop(code: number) {
            if (this.readyState === WebSocket.CLOSED) return;
            this.readyState = WebSocket.CLOSED;
            this.emit('close', code);
        }
    }
    const control = {
        operateData: (...args: Parameters<PilotRpc['operateData']>) => input.rpc().operateData(...args),
        accountControlBytes: (bytes: number) => input.rpc().accountControlBytes(bytes),
        noteThrottle: (value: string | null, at?: number) => input.rpc().noteThrottle(value, at),
        cooldownUntil: () => input.rpc().cooldownUntil(),
        controlCooldownUntil: () => input.rpc().controlCooldownUntil()
    } as PilotNativeFlowOptions['control'];
    const support: PilotNativeFlowOptions['support'] = {
        async validateMany(requests, signal, admission) {
            // This accounted read supplies the declared synthetic Clock. It
            // is not a claim that arbitrary peer account bytes passed SDK validation.
            const bankClock = await input.rpc().call<number>('getBlockTime', [input.slot()], signal, admission as PilotRpcCallOptions);
            const at = input.now(), sourceSlot = input.slot();
            supports.push({ at, mints: requests.map(row => row.mint.toBase58()) });
            return {
                validations: Object.fromEntries(requests.map(row => {
                    const mint = row.mint.toBase58();
                    return [mint, { mint, pool: canonicalPumpPoolPda(new PublicKey(mint)).toBase58(), at, sourceSlot,
                        evidence: 'OFFLINE_SYNTHETIC_DECLARED_POOL_SUPPORT:' + mint,
                        summary: { marketClockUnixSeconds: bankClock, tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' } }];
                })),
                unavailable: {},
                context: { slot: sourceSlot, requestedAt: new Date(at).toISOString(), receivedAt: new Date(at).toISOString(), marketClockUnixSeconds: bankClock }
            } as Awaited<ReturnType<PilotNativeFlowOptions['support']['validateMany']>>;
        }
    };
    const flow = new PilotNativeFlow({
        persistent: true, dataContract: 'confirmed-program-activity-v3-shadow', maximumCandidates: 4,
        maximumRssBytes: 1024 * 1024 * 1024, control, support,
        informationAdmissionOpen: () => true,
        ...input.callbacks,
        onTrade() { throw new Error('OFFLINE economic flow is supplied separately; no socket trade parser is simulated'); }
    }, {
        now: input.now, monotonic: input.now,
        setTimer(fn, ms) { const id = ++timerSequence; timers.set(id, { at: input.now() + ms, fn }); return id; },
        clearTimer(id) { timers.delete(id as number); },
        makeSocket(endpoint, options) {
            assert.equal(endpoint, 'wss://api.mainnet.solana.com');
            assert.equal(options.autoPong, false);
            assert.equal(options.followRedirects, false);
            const socket = new Socket();
            queueMicrotask(() => socket.open());
            return socket as unknown as WebSocket;
        }
    });
    return {
        flow, sent, supports,
        holdNextUnsubscribe() { assert.equal(pendingUnsubscribe, null); holdUnsubscribe = true; },
        pendingUnsubscribe: () => pendingUnsubscribe !== null,
        acknowledgeUnsubscribe() {
            assert.ok(pendingUnsubscribe);
            const pending = pendingUnsubscribe;
            pendingUnsubscribe = null;
            pending.socket.acknowledge(pending.request);
        },
        advanceTimers() {
            for (const [id, timer] of [...timers]) if (timer.at <= input.now()) { timers.delete(id); timer.fn(); }
        }
    };
}
