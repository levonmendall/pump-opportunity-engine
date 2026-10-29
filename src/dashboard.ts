import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import {holographicDashboard} from './dashboard-holographic.js';
import {ORIGINAL_POE_ACCOUNT,ORIGINAL_POE_INCEPTION} from './operating-intelligence.js';
import { fileURLToPath } from 'node:url';
import { MAX_SNAPSHOT_BYTES, SnapshotCache, operatingSnapshotFreshness, type ReportingIdentity } from './reporting.js';

const equal = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
export type DashboardConfig = Partial<ReportingIdentity> & { viewerUser: string; viewerPassword: string; ingestionSecret: string; publicViewer?: boolean };
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = []; let rejected = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_SNAPSHOT_BYTES) {
        if (!rejected) { rejected = true; reject(new Error('payload limit')); }
        chunks.length = 0; return;
      }
      if (!rejected) chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', () => reject(new Error('request unavailable')));
  });
}
/** One reporting cache. No ledger, execution, provider or runtime-control imports. */
export function createDashboard(config: DashboardConfig) {
  // Public access is an explicit opt-in. Never relax the separate machine ingestion secret.
  const publicViewer = config.publicViewer === true;
  if (typeof config.ingestionSecret !== 'string' || config.ingestionSecret.length < 24) throw new Error('strong ingestion secret required');
  if (!publicViewer && (typeof config.viewerUser !== 'string' || !config.viewerUser || config.viewerUser.includes(':') || typeof config.viewerPassword !== 'string' || config.viewerPassword.length < 16 || config.viewerPassword === config.ingestionSecret)) throw new Error('independent strong viewer/ingestion credentials required');
  const sourceFields = [config.accountId, config.inceptionAt, config.release, config.strategy];
  const configured = sourceFields.filter(value => value !== undefined && value !== '').length;
  if (configured !== 0 && configured !== 4) throw new Error('complete source identity required; configure all four fields or none');
  const cache = new SnapshotCache(configured === 4 ? {
    accountId: config.accountId!, inceptionAt: config.inceptionAt!, release: config.release!, strategy: config.strategy!,
  } : null);
  const viewer = publicViewer ? null : 'Basic ' + Buffer.from(`${config.viewerUser}:${config.viewerPassword}`).toString('base64');
  const publisher = `Bearer ${config.ingestionSecret}`;
  if (process.env.POE_PILOT_INGEST_SECRET && equal(process.env.POE_PILOT_INGEST_SECRET, config.ingestionSecret)) throw new Error('pilot and original publishing credentials must differ');
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    const path = req.url?.split('?')[0];
    if(path==='/api/pilot'){req.resume();send(res,410,{error:'retired-channel',message:'Use the original authoritative portfolio at /api/snapshot'});return;}
    if (path === '/healthz' && req.method === 'GET') { send(res, 200, { ok: true, service: 'poe-dashboard', dashboardRelease: process.env.RENDER_GIT_COMMIT ?? 'local-build', reportingSchema: 1, unifiedPortfolio: true }); return; }
    if (path === '/api/snapshot' && req.method === 'POST') {
      if (!equal(req.headers.authorization ?? '', publisher)) { req.resume(); send(res, 401, { error: 'unauthorized' }); return; }
      if (cache.identity === null) { req.resume(); send(res, 503, { error: 'source-not-configured', message: 'Awaiting POE data' }); return; }
      if (req.headers['content-type']?.split(';')[0] !== 'application/json' || req.headers['content-encoding']) { req.resume(); send(res, 415, { error: 'plain application/json required' }); return; }
      if (Number(req.headers['content-length'] ?? 0) > MAX_SNAPSHOT_BYTES) { req.resume(); send(res, 413, { error: 'payload limit' }); return; }
      try { send(res, 200, { result: cache.accept(await readBody(req)) }); }
      catch (e) {
        const message = e instanceof Error ? e.message : 'invalid snapshot';
        send(res, message === 'source-not-configured' ? 503 : message === 'payload limit' ? 413 : /regression|conflict/.test(message) ? 409 : 400, { error: message });
      }
      return;
    }
    if (viewer !== null && !equal(req.headers.authorization ?? '', viewer)) {
      res.setHeader('www-authenticate', 'Basic realm="POE owner", charset="UTF-8"');
      req.resume(); send(res, 401, { error: 'owner authentication required' }); return;
    }
    if (req.method !== 'GET') { req.resume(); send(res, 405, { error: 'read-only viewer' }); return; }
    if (path === '/status') { send(res, 200, cache.status()); return; }
    if (path === '/api/snapshot' || path === '/api/export') {
      const current = cache.read();
      if (!current) { send(res, 503, { state: 'waiting', message: 'Awaiting POE data' }); return; }
      if (path === '/api/export') res.setHeader('content-disposition', 'attachment; filename="poe-bounded-snapshot.json"');
      send(res, 200, { ...current, freshness: cache.status() }); return;
    }
    if (path !== '/') { send(res, 404, { error: 'not found' }); return; }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    });
    res.end(holographicDashboard(HTML));
  });
  server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 100;
  return { server, cache };
}

const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#060b16">
<meta name="description" content="Pump Opportunity Engine — verifiable Solana paper-trading intelligence terminal.">
<title>POE // Opportunity Command Center</title>
<style>
:root{color-scheme:dark;--bg:#060b16;--base:#091120;--panel:#0c1525;--panel2:#101e31;--border:rgba(116,157,203,.17);--muted:#8ca0ba;--subtle:#58708e;--white:#eff9ff;--cyan:#50f0ec;--blue:#71a9ff;--violet:#b78cff;--mint:#52e5b5;--red:#ff8295;--mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;--sans:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(ellipse 48% 30% at 80% 0%,rgba(90,76,170,.14),transparent 90%),radial-gradient(ellipse 50% 45% at 0% 45%,rgba(21,138,158,.09),transparent 85%),var(--bg);color:var(--white);font-family:var(--sans);font-size:14px;-webkit-font-smoothing:antialiased;line-height:1.55;min-width:290px}
[hidden]{display:none!important}a{color:inherit;text-decoration:none}button{font:inherit}::selection{background:#286d8c;color:#fff}
body:before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-2;background:radial-gradient(ellipse 52% 33% at 80% -8%,rgba(77,61,164,.24),transparent 75%),radial-gradient(ellipse 43% 43% at -9% 47%,rgba(15,126,159,.13),transparent 78%),linear-gradient(180deg,#070d1b 0%,#060b16 54%,#080f1d 100%)}
body:after{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;opacity:.24;background-image:linear-gradient(rgba(83,145,181,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(83,145,181,.05) 1px,transparent 1px);background-size:54px 54px;mask-image:linear-gradient(180deg,#000 0%,transparent 82%)}
.app{min-height:100vh;display:grid;grid-template-columns:88px minmax(0,1fr);max-width:1780px;margin:auto}
.rail{position:sticky;top:0;height:100vh;border-right:1px solid var(--border);background:rgba(7,14,28,.9);display:flex;align-items:center;flex-direction:column;padding:30px 10px 24px;gap:57px;z-index:4;backdrop-filter:blur(20px)}
.brand-mark{display:flex;justify-content:center;align-items:center;width:49px;height:49px;border:1px solid rgba(80,240,236,.43);border-radius:16px;background:linear-gradient(140deg,rgba(58,208,220,.16),rgba(116,82,234,.13));box-shadow:0 0 34px rgba(56,224,218,.13),inset 0 0 20px rgba(53,175,232,.06)}
.brand-mark svg{width:28px;height:28px}.rail-links{display:flex;flex-direction:column;gap:13px;width:100%;align-items:center}.rail-link{display:flex;align-items:center;justify-content:center;width:53px;height:53px;border-radius:14px;color:#7187a3;border:1px solid transparent;transition:all .2s;position:relative}.rail-link svg{width:22px;height:22px;stroke:currentColor;stroke-width:1.6;fill:none;stroke-linecap:round;stroke-linejoin:round}.rail-link:hover,.rail-link:focus-visible,.rail-link.selected{color:var(--cyan);border-color:rgba(80,240,236,.2);background:rgba(80,240,236,.075)}.rail-link.selected:before{content:"";position:absolute;left:-12px;top:17px;width:3px;height:18px;border-radius:4px;background:var(--cyan);box-shadow:0 0 13px var(--cyan)}.rail-foot{margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:9px;font:9px var(--mono);letter-spacing:1.4px;color:var(--subtle);writing-mode:vertical-rl}.rail-foot:before{content:"";width:5px;height:5px;border-radius:50%;background:var(--mint);box-shadow:0 0 12px var(--mint)}
.workspace{min-width:0;padding:0 clamp(20px,3.1vw,52px) 36px}
.topbar{height:96px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);gap:16px}.breadcrumb{font:10px var(--mono);letter-spacing:2px;color:#7288a8;text-transform:uppercase}.breadcrumb span{color:var(--cyan)}.top-label{font-size:15px;font-weight:650;letter-spacing:-.2px;margin-top:5px}.top-actions{display:flex;align-items:center;gap:16px}.clock{display:flex;flex-direction:column;align-items:flex-end;border-right:1px solid var(--border);padding-right:17px;white-space:nowrap}.clock small{font:9px var(--mono);letter-spacing:1.4px;color:#6c82a3}.clock strong{font:600 13px var(--mono);color:#c2d5ec;margin-top:4px}.chip{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(115,151,192,.25);background:rgba(21,34,58,.62);padding:7px 12px;border-radius:8px;font:600 10px var(--mono);letter-spacing:1px;color:#9db4d2;white-space:nowrap}.chip i{width:6px;height:6px;background:var(--violet);border-radius:50%;box-shadow:0 0 10px rgba(183,140,255,.8)}.export-link{border:1px solid rgba(80,240,236,.3);color:var(--cyan);display:flex;align-items:center;gap:9px;border-radius:9px;padding:11px 14px;background:rgba(80,240,236,.07);font:600 11px var(--mono);letter-spacing:.8px;transition:background .2s}.export-link:hover{background:rgba(80,240,236,.15)}.export-link svg{width:14px;height:14px;stroke:currentColor;stroke-width:1.8;fill:none}
main{max-width:1480px;margin:0 auto}
.hero{position:relative;min-height:348px;display:grid;grid-template-columns:minmax(0,1.18fr) minmax(300px,.82fr);gap:16px;overflow:hidden;margin:26px 0 18px;border:1px solid rgba(92,161,216,.27);border-radius:19px;background:linear-gradient(110deg,rgba(12,28,48,.97) 0%,rgba(12,24,44,.93) 53%,rgba(15,22,47,.94) 100%);box-shadow:0 23px 85px rgba(0,0,0,.21),inset 0 1px 0 rgba(167,220,255,.06)}
.hero:before{content:"";pointer-events:none;position:absolute;inset:0;background:linear-gradient(125deg,rgba(80,240,236,.04),transparent 50%),repeating-linear-gradient(90deg,transparent 0 78px,rgba(126,188,255,.025) 79px 80px)}.hero:after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,var(--cyan),rgba(110,173,255,.6),rgba(175,130,255,.28),transparent)}
.hero-copy{position:relative;z-index:2;padding:48px 0 43px clamp(24px,3.8vw,62px);align-self:center}.eyebrow{color:var(--cyan);font:600 11px var(--mono);letter-spacing:2px;text-transform:uppercase;display:flex;align-items:center;gap:13px}.eyebrow:before{content:"";width:19px;height:1px;background:var(--cyan);box-shadow:0 0 12px var(--cyan)}h1{font-weight:760;font-size:clamp(43px,4.7vw,75px);line-height:1.03;letter-spacing:-.075em;margin:19px 0 17px;max-width:700px}h1 span{display:block;color:transparent;background:linear-gradient(100deg,#54fff2 0%,#76baff 42%,#b697ff 94%);-webkit-background-clip:text;background-clip:text;text-shadow:0 0 45px rgba(80,240,236,.075)}.hero-description{font-size:13px;color:#a3b7d0;max-width:470px;line-height:1.75;margin:0 0 24px}.hero-chips{display:flex;gap:9px;flex-wrap:wrap}.hero-chip{color:#a7b9d3;padding:7px 10px;border:1px solid rgba(128,163,203,.19);background:rgba(10,17,32,.62);border-radius:5px;font:600 9px var(--mono);letter-spacing:.85px}.hero-chip.primary{color:var(--cyan);border-color:rgba(80,240,236,.3)}.hero-chip.danger{color:#ffafbd;border-color:rgba(255,130,149,.22)}
.hero-visual{position:relative;min-height:330px;overflow:hidden}.hero-visual:after{content:"";position:absolute;right:-13%;top:0;bottom:0;width:130%;background:radial-gradient(ellipse at 57% 52%,rgba(73,184,227,.09),transparent 53%),linear-gradient(90deg,rgba(10,19,35,.0),rgba(5,14,30,.22))}
.radar{position:absolute;width:330px;height:330px;top:50%;left:50%;transform:translate(-48%,-50%);border-radius:50%;background:radial-gradient(circle,rgba(42,204,220,.13) 0 5%,transparent 5% 100%),repeating-radial-gradient(circle,transparent 0 43px,rgba(98,177,214,.15) 44px 45px,transparent 46px 63px),linear-gradient(90deg,transparent 49.8%,rgba(109,193,212,.2) 50%,transparent 50.2%),linear-gradient(0deg,transparent 49.8%,rgba(109,193,212,.2) 50%,transparent 50.2%);border:1px solid rgba(107,164,215,.12);box-shadow:0 0 90px rgba(66,200,240,.07)}.radar:before{content:"";position:absolute;inset:14%;border-radius:50%;border:1px dashed rgba(80,240,236,.25);animation:spin 48s linear infinite}.radar:after{content:"";position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,transparent 0deg,transparent 290deg,rgba(73,232,221,.045) 318deg,rgba(73,232,221,.24) 359deg,transparent 360deg);animation:spin 10s linear infinite}.radar-core{position:absolute;inset:95px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle,rgba(31,79,111,.61),rgba(9,25,45,.98) 68%);border:1px solid rgba(83,244,231,.3);box-shadow:0 0 65px rgba(51,199,222,.2),inset 0 0 30px rgba(80,240,236,.05);z-index:1}.radar-core strong{font:800 44px var(--sans);letter-spacing:-4px;color:#d7ffff;line-height:1;text-shadow:0 0 30px rgba(80,240,236,.5)}.radar-core small{font:9px var(--mono);letter-spacing:1.7px;color:#8fc5d7;margin-top:10px}.radar-node{position:absolute;border-radius:50%;width:8px;height:8px;background:var(--cyan);box-shadow:0 0 0 6px rgba(80,240,236,.06),0 0 20px rgba(80,240,236,.8);z-index:2;top:26%;left:15%}.radar-node.two{top:67%;left:78%;width:6px;height:6px;background:var(--violet);box-shadow:0 0 0 6px rgba(183,140,255,.1),0 0 17px rgba(183,140,255,.8)}.radar-node.three{top:83%;left:29%;width:4px;height:4px;background:#87b9fb}.visual-caption{position:absolute;right:24px;bottom:25px;color:#6086a6;font:9px var(--mono);letter-spacing:1.6px;z-index:2;text-align:right}
.status-strip{display:flex;justify-content:space-between;align-items:center;gap:20px;border:1px solid rgba(98,151,202,.22);background:linear-gradient(110deg,rgba(16,29,49,.8),rgba(11,21,39,.7));border-radius:13px;padding:20px 24px;min-height:116px;box-shadow:inset 3px 0 rgba(80,240,236,.35)}.status-content{display:flex;align-items:center;gap:20px;min-width:0}.status-beacon{width:44px;height:44px;flex-shrink:0;display:grid;place-items:center;border:1px solid rgba(80,240,236,.22);background:rgba(80,240,236,.05);border-radius:50%}.status-beacon:before{content:"";width:10px;height:10px;background:var(--subtle);border-radius:50%;box-shadow:0 0 0 6px rgba(95,132,171,.1)}.status-caption{font:600 10px var(--mono);letter-spacing:1.4px;color:#748cad;margin-bottom:5px}.status-title{font-size:19px;line-height:1.2;font-weight:700;letter-spacing:-.4px}.status-detail{font:11px var(--mono);color:#93a9c3;margin-top:7px;line-height:1.55;max-width:640px;white-space:pre-wrap;overflow-wrap:anywhere}.status-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px;text-align:right;flex-shrink:0}.status-code{font:600 10px var(--mono);letter-spacing:.8px;color:var(--cyan)}.status-time{font:10px var(--mono);color:var(--subtle)}body[data-link="connected"] .status-beacon:before{background:var(--mint);box-shadow:0 0 0 7px rgba(82,229,181,.1),0 0 18px rgba(82,229,181,.5);animation:breath 2.4s ease-in-out infinite}body[data-link="warning"] .status-beacon:before{background:#ffbd70;box-shadow:0 0 0 7px rgba(255,189,112,.1)}body[data-link="error"] .status-beacon:before{background:var(--red);box-shadow:0 0 0 7px rgba(255,130,149,.1)}body[data-link="error"] .status-code{color:var(--red)}
.section-heading{margin:37px 0 18px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}.section-index{font:600 10px var(--mono);letter-spacing:1.6px;color:var(--cyan);text-transform:uppercase}.section-heading h2,.panel-heading h2{font-size:23px;font-weight:720;letter-spacing:-.65px;line-height:1.2;margin:6px 0 0}.section-note{color:#718aa7;font:10px var(--mono);text-align:right;line-height:1.6;max-width:330px}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px}.stat{border:1px solid var(--border);border-radius:13px;padding:21px;min-width:0;min-height:137px;position:relative;overflow:hidden;background:linear-gradient(135deg,rgba(20,36,59,.89),rgba(11,22,38,.85));box-shadow:0 12px 36px rgba(0,0,0,.07),inset 0 1px 0 rgba(189,220,255,.03);transition:transform .22s,border-color .22s}.stat:hover{transform:translateY(-3px);border-color:rgba(83,216,238,.42)}.stat:before{content:"";position:absolute;width:120px;height:120px;right:-40px;top:-65px;background:radial-gradient(circle,rgba(88,150,220,.14),transparent 70%)}.stat.top{background:linear-gradient(130deg,rgba(20,53,70,.8),rgba(13,23,46,.96));border-color:rgba(67,212,219,.27)}.stat.top:after{content:"";position:absolute;left:20px;right:20px;bottom:0;height:2px;background:linear-gradient(90deg,rgba(80,240,236,.8),transparent)}.stat-label{font:600 10px var(--mono);color:#91a5c1;letter-spacing:1.15px;line-height:1.4;min-height:14px}.stat-value{font-weight:740;font-size:clamp(22px,2.25vw,33px);letter-spacing:-1.4px;color:#eaf6ff;line-height:1.2;margin:19px 0 10px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.stat-value.long{font-size:18px;letter-spacing:-.5px}.stat-value.positive{color:var(--mint)}.stat-value.negative{color:var(--red)}.stat-foot{font:10px var(--mono);color:#6683a1;line-height:1.4}.stat.empty .stat-value{color:#56708e}.stat.empty .stat-foot{color:#6d829c}
.panel{background:linear-gradient(150deg,rgba(14,27,45,.92),rgba(8,17,33,.94));border:1px solid var(--border);border-radius:16px;padding:25px;min-width:0;box-shadow:0 17px 45px rgba(0,0,0,.07);position:relative;overflow:hidden}.panel:before{content:"";position:absolute;inset:0 0 auto 0;height:1px;background:linear-gradient(90deg,rgba(80,240,236,.2),rgba(132,178,245,.05),transparent)}.panel-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:15px;margin-bottom:22px}.panel-heading h2{font-size:21px;margin:5px 0 0}.panel-sub{margin:7px 0 0;color:#7993b1;font:11px var(--mono)}.panel-tag{border:1px solid rgba(81,173,194,.26);border-radius:5px;padding:7px 10px;color:var(--cyan);font:600 9px var(--mono);letter-spacing:1px;white-space:nowrap}
.chart-panel{margin-top:18px;padding:25px 25px 20px}.chart-shell{position:relative;overflow:hidden;border:1px solid rgba(117,169,219,.12);border-radius:10px;background:linear-gradient(180deg,rgba(3,12,25,.38),rgba(5,14,30,.18));min-height:280px}.chart-shell:before{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,transparent 0 44px,rgba(83,153,197,.065) 45px 46px),repeating-linear-gradient(90deg,transparent 0 83px,rgba(83,153,197,.05) 84px 85px)}.chart-shell:after{content:"";pointer-events:none;position:absolute;inset:0;opacity:.35;background:linear-gradient(90deg,rgba(60,192,234,.03),transparent,rgba(116,105,223,.05))}.chart-shell svg{width:100%;height:280px;display:block;position:relative;z-index:1;overflow:visible}.chart-meta{display:flex;justify-content:space-between;gap:24px;padding:14px 2px 0;color:#7c93af;font:10px var(--mono);line-height:1.7}.chart-meta span{overflow-wrap:anywhere}.chart-legend{white-space:nowrap;color:#a1bad0}.chart-legend:before{content:"";display:inline-block;width:14px;height:2px;vertical-align:middle;margin-right:8px;background:var(--cyan);box-shadow:0 0 10px var(--cyan)}.chart-note{font:10px var(--mono);color:#6684a3;margin-top:6px}
.chart-controls{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:7px 2px 0}
.chart-window-label{color:#94a9c4;font:600 9px/1.5 var(--mono);letter-spacing:.7px}
.chart-range-toggle{border:1px solid rgba(138,245,219,.28);border-radius:7px;padding:7px 11px;background:rgba(93,208,181,.06);color:#b4f4e6;cursor:pointer;font:600 10px var(--mono)}
.chart-range-toggle:hover{border-color:rgba(138,245,219,.65)}
.chart-range-toggle:focus-visible{outline:2px solid #96ffec;outline-offset:3px}
.chart-range-toggle[hidden]{display:none!important}

.two-up,.system-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:17px;margin-top:17px}.data-panel{min-height:286px}.data-panel .panel-heading{margin-bottom:16px}.table-wrap{width:100%;overflow-x:auto}.data-table{border-collapse:collapse;width:100%;font-size:12px;min-width:440px}.data-table th{text-align:left;font:600 9px var(--mono);letter-spacing:1.1px;color:#6b8aa9;text-transform:uppercase;padding:11px 11px 13px;border-bottom:1px solid rgba(105,149,197,.17)}.data-table td{padding:15px 11px;color:#bed0e1;border-bottom:1px solid rgba(105,149,197,.12);max-width:210px;overflow-wrap:anywhere;vertical-align:top}.data-table tr:last-child td{border-bottom:0}.no-records{min-height:155px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;color:#7d95b1;gap:10px;padding:20px}.no-records:before{content:"";display:block;width:35px;height:35px;border:1px dashed rgba(80,240,236,.33);border-radius:10px;background:radial-gradient(circle,rgba(80,240,236,.12),transparent 68%);transform:rotate(45deg)}.no-records strong{font:600 11px var(--mono);color:#aec9e1;letter-spacing:.8px}.no-records span{font:11px var(--mono);color:#617c9a;max-width:300px}
/* Native disclosure keeps the verified trade count visible while conserving dashboard space. */
.data-panel.paper-trades-panel{min-height:0;align-self:start}
.paper-trades-disclosure{min-width:0}
.paper-trades-summary{cursor:pointer;list-style:none;min-height:44px;align-items:center;margin-bottom:0!important;user-select:none}
.paper-trades-summary::-webkit-details-marker{display:none}
.paper-trades-summary::marker{content:""}
.paper-trades-summary:focus-visible{outline:2px solid #96ffec;outline-offset:4px;border-radius:6px}
.paper-trades-summary:hover h2{color:var(--cyan)}
.paper-trades-actions{display:flex;gap:9px;align-items:center;flex:0 0 auto}
.paper-trades-icon{display:flex;align-items:center;justify-content:center;width:27px;height:27px;border-radius:7px;border:1px solid rgba(80,240,236,.27);color:var(--cyan);font:700 18px var(--mono)}
.paper-trades-icon:before{content:"+"}
.paper-trades-disclosure[open] .paper-trades-icon:before{content:"−"}
.paper-trades-disclosure[open]>.paper-trades-summary{padding-bottom:12px;border-bottom:1px solid rgba(105,149,197,.18)}
.paper-trades-body{padding-top:12px}
.paper-trades-body>.panel-sub:first-child{margin-top:0}
@media print{.paper-trades-disclosure>.paper-trades-body{display:block!important}}

.funnel-grid{display:flex;flex-direction:column;gap:13px}.funnel-line{display:grid;grid-template-columns:minmax(90px,1fr) minmax(70px,2fr) 40px;gap:12px;align-items:center}.funnel-name{font:10px var(--mono);color:#98adc7;overflow-wrap:anywhere}.funnel-track{height:5px;background:rgba(112,145,192,.13);border-radius:6px;overflow:hidden}.funnel-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#4edbdc,#8694ff);box-shadow:0 0 12px rgba(80,240,236,.3)}.funnel-count{text-align:right;font:12px var(--mono);color:#b3d7e7}.metric-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.metric{padding:13px;border:1px solid rgba(118,160,200,.13);background:rgba(6,18,33,.54);border-radius:9px;min-width:0}.metric-name{color:#7895b3;font:10px var(--mono);overflow-wrap:anywhere}.metric-value{color:#d7eaff;font:600 13px var(--mono);margin-top:9px;overflow-wrap:anywhere}.full-panel{margin-top:17px}.identity-line{font:10px var(--mono);color:#7690ae;overflow-wrap:anywhere}
.footer{padding:38px 1px 10px;display:flex;align-items:center;justify-content:space-between;gap:18px;color:#67809f;font:10px var(--mono);letter-spacing:.3px;border-top:1px solid rgba(110,156,199,.13);margin-top:35px}.footer strong{color:var(--cyan);font-weight:600}.footer a{color:#a6c8e8}.footer a:hover{color:var(--cyan)}
@keyframes spin{to{transform:rotate(360deg)}}@keyframes breath{50%{opacity:.46;transform:scale(.75)}}
@media(max-width:1200px){.hero{grid-template-columns:minmax(0,1fr) 300px}.hero-copy{padding-left:34px}h1{font-size:clamp(39px,4.8vw,63px)}.cards{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:900px){.app{grid-template-columns:66px minmax(0,1fr)}.rail{padding:23px 5px}.rail-link{width:44px;height:48px}.rail-link.selected:before{left:-8px}.workspace{padding:0 18px 28px}.hero{grid-template-columns:1fr 210px;min-height:305px}.hero-visual{min-height:305px}.hero-copy{padding:33px 0 33px 26px}h1{font-size:clamp(38px,5.2vw,53px)}.radar{transform:translate(-42%,-50%) scale(.8)}.visual-caption{right:16px}.clock{display:none}.two-up,.system-grid{grid-template-columns:1fr}}
@media(max-width:640px){html{scroll-behavior:auto}.app{display:block}.rail{position:static;height:66px;width:100%;flex-direction:row;border-right:0;border-bottom:1px solid var(--border);padding:10px 15px;gap:0;justify-content:space-between}.brand-mark{width:42px;height:42px;border-radius:12px}.rail-links{flex-direction:row;width:auto;gap:3px}.rail-link{width:44px;height:43px}.rail-link.selected:before{left:15px;top:auto;bottom:-11px;width:14px;height:2px}.rail-foot{display:none}.workspace{padding:0 14px 20px}.topbar{height:83px}.breadcrumb{font-size:9px;letter-spacing:1.2px}.top-label{font-size:13px}.top-actions{gap:8px}.chip{font-size:9px;padding:7px 8px}.export-link{font-size:10px;padding:9px}.export-link svg{width:13px;height:13px}.hero{margin-top:14px;grid-template-columns:1fr;min-height:0;border-radius:14px}.hero-copy{padding:32px 23px 23px}.eyebrow{font-size:9px;letter-spacing:1.2px}.hero h1{font-size:clamp(38px,9.1vw,59px);margin:18px 0 17px}.hero-description{font-size:12px;line-height:1.7}.hero-chips{gap:6px}.hero-chip{font-size:8px;padding:6px 7px}.hero-visual{height:165px;min-height:165px;overflow:hidden;border-top:1px solid rgba(80,240,236,.08)}.radar{left:50%;top:27%;transform:translate(-50%,-50%) scale(.62)}.visual-caption{bottom:14px;right:17px}.status-strip{padding:16px;display:block}.status-content{gap:12px}.status-beacon{width:38px;height:38px}.status-title{font-size:16px}.status-right{padding-left:50px;align-items:flex-start;margin-top:9px;gap:2px;text-align:left}.section-heading{margin-top:28px;align-items:flex-start}.section-heading h2{font-size:20px}.section-note{font-size:9px;max-width:135px}.cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.stat{padding:16px 13px;min-height:125px}.stat-label{font-size:9px;letter-spacing:.5px}.stat-value{font-size:23px;margin-top:17px}.stat-value.long{font-size:15px}.stat-foot{font-size:9px}.panel,.chart-panel{padding:18px;border-radius:12px}.panel-heading{flex-wrap:wrap;margin-bottom:16px}.panel-heading h2{font-size:19px}.panel-tag{font-size:8px}.chart-shell{min-height:225px}.chart-shell svg{height:225px}.chart-meta{flex-wrap:wrap;gap:4px}.metric-grid{grid-template-columns:1fr 1fr}.metric{padding:11px}.metric-value{font-size:11px}.funnel-line{grid-template-columns:minmax(70px,1fr) minmax(50px,1fr) 33px;gap:9px}.funnel-name{font-size:9px}.footer{display:block;line-height:1.8;margin-top:25px}.footer div+div{margin-top:9px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;scroll-behavior:auto!important;transition:none!important}}

/* Compact command view: full source data and details remain accessible. */
body.poe-compact-view .status-strip{margin:6px 0 10px!important}
body.poe-compact-view .compact-quick-links{display:flex;flex-wrap:wrap;gap:7px;margin:8px 0 17px}
body.poe-compact-view .compact-quick-links a{display:inline-flex;align-items:center;min-height:37px;border:1px solid rgba(151,177,223,.24);background:rgba(30,41,71,.42);padding:7px 12px;border-radius:8px;font:600 10px var(--mono);color:#c8daec;white-space:nowrap}
body.poe-compact-view .compact-quick-links a:focus-visible,body.poe-compact-view .compact-toggle:focus-visible,body.poe-compact-view summary:focus-visible{outline:2px solid #96ffec;outline-offset:3px}
body.poe-compact-view .compact-quick-links a:hover{border-color:rgba(140,255,225,.55);color:#caffef}
body.poe-compact-view main>.panel,body.poe-compact-view main>.section-heading,body.poe-compact-view main>section:not(.hero){margin-top:12px;margin-bottom:12px}
body.poe-compact-view .panel{padding:20px!important}
body.poe-compact-view .panel-heading{margin-bottom:10px}
body.poe-compact-view .compact-folded>.panel-heading{margin-bottom:0}
body.poe-compact-view .compact-disclosure{display:block;margin-top:11px;border-top:1px solid rgba(166,181,223,.13);padding-top:8px;min-width:0}
body.poe-compact-view .compact-disclosure>summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:42px;color:#aacee7;font:600 11px var(--mono);padding:8px 0}
body.poe-compact-view .compact-disclosure>summary::-webkit-details-marker{display:none}
body.poe-compact-view .compact-disclosure>summary:after{content:"+";flex:0 0 auto;font:600 18px var(--mono);color:#8affea}
body.poe-compact-view .compact-disclosure[open]>summary:after{content:"−"}
body.poe-compact-view .compact-disclosure-body{padding-top:9px}
body.poe-compact-view .compact-toggle{display:block;width:100%;text-align:left;cursor:pointer;margin:9px 0 0;padding:11px 13px;background:rgba(68,90,140,.12);color:#addccf;border:1px solid rgba(136,185,226,.25);border-radius:8px;font:600 11px var(--mono)}
body.poe-compact-view .compact-toggle:hover{border-color:rgba(138,255,234,.48)}
body.poe-compact-view #portfolio:not(.compact-expanded) #cards>.stat:nth-child(n+7){display:none!important}
body.poe-compact-view .section-heading{margin-top:20px!important;margin-bottom:10px!important}
body.poe-compact-view .section-heading .section-note{font-size:9px}
body.poe-compact-view .compact-folded{min-height:0}
@media(max-width:640px){
 body.poe-compact-view .topbar{height:64px!important}
 body.poe-compact-view .panel{padding:15px!important}
 body.poe-compact-view .compact-quick-links{gap:5px;margin:7px 0 12px}
 body.poe-compact-view .compact-quick-links a{flex:1 1 auto;justify-content:center;font-size:9px;padding:6px 8px;min-height:35px}
 body.poe-compact-view .stat{padding:13px!important}
}
@media print{
 body.poe-compact-view .hero-visual{display:none!important}
 body.poe-compact-view .compact-quick-links,body.poe-compact-view .compact-toggle{display:none!important}
 body.poe-compact-view #portfolio #cards>.stat{display:block!important}
 body.poe-compact-view .compact-disclosure-body{display:block!important}
}

</style>
</head>
<body data-link="pending">
<div class="app">
<aside class="rail" aria-label="Dashboard navigation">
<a href="#top" class="brand-mark" aria-label="Pump Opportunity Engine home"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 25V7h9l6 6-6 6H5M20 7h7v18h-7" stroke="#65f3f0" stroke-width="3" fill="none" stroke-linejoin="round"/></svg></a>
<nav class="rail-links" aria-label="Sections">
<a class="rail-link selected" href="#overview" title="Overview" aria-label="Overview"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></a>
<a class="rail-link" href="#performance" title="Performance" aria-label="Performance"><svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 3 8-9"/><path d="M15 5h6v6"/></svg></a>
<a class="rail-link" href="#activity" title="Activity" aria-label="Activity"><svg viewBox="0 0 24 24"><path d="M3 4h18v16H3z"/><path d="M7 9h10M7 13h7M7 17h5"/></svg></a>
<a class="rail-link" href="#system" title="System" aria-label="System"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg></a>
</nav>
<div class="rail-foot">READ ONLY · POE</div>
</aside>
<div class="workspace">
<header class="topbar" id="top">
<div><div class="breadcrumb">POE <span>//</span> OPERATIONS <span>//</span> SOLANA</div><div class="top-label">Command overview</div></div>
<div class="top-actions"><div class="clock"><small>UTC · SYSTEM CLOCK</small><strong id="utcClock">--:--:-- UTC</strong></div><span class="chip"><i></i>PAPER ONLY</span><a id="exportLink" class="export-link" href="/api/export" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4"/></svg>EXPORT</a></div>
</header>
<button id="refreshNow" class="export-link" type="button">Refresh dashboard</button>
<main>
<section class="hero" id="overview" aria-labelledby="pageTitle">
<div class="hero-copy"><div class="eyebrow">PRECISION MARKET INTELLIGENCE</div><h1 id="pageTitle">PUMP<br><span>OPPORTUNITY</span>ENGINE.</h1><p class="hero-description">An on-chain research terminal built for decisive signals, disciplined risk, and transparent PAPER performance. Every number comes from verified source data.</p><div class="hero-chips"><span class="hero-chip primary">SOLANA / PUMPSWAP</span><span class="hero-chip danger">LIVE EXECUTION DISABLED</span><span class="hero-chip">NO DEMO PERFORMANCE</span></div></div>
<div class="hero-visual" aria-hidden="true"><div class="radar"><div class="radar-core"><strong>POE</strong><small>SIGNAL CORE</small></div><i class="radar-node"></i><i class="radar-node two"></i><i class="radar-node three"></i></div><div class="visual-caption">FIG 01 / SIGNAL RADAR<br>DECORATIVE VISUALIZATION</div></div>
</section>
<section class="status-strip" role="status" aria-live="polite"><div class="status-content"><div class="status-beacon" aria-hidden="true"></div><div><div class="status-caption">ENGINE STATE · VERIFIED SOURCE</div><div class="status-title" id="stateTitle">Awaiting authoritative data</div><div class="status-detail" id="state">No authenticated EC2 snapshot has been received. Performance will appear only when real PAPER reporting is available.</div></div></div><div class="status-right"><div class="status-code" id="sourceLabel">NO VERIFIED SNAPSHOT</div><div class="status-time" id="lastSync">RECEIVER · AWAITING DATA</div></div></section>
<section aria-labelledby="portfolioTitle" id="portfolio"><div class="section-heading"><div><div class="section-index">01 / PORTFOLIO INTELLIGENCE</div><h2 id="portfolioTitle">Portfolio overview</h2></div><div class="section-note">AUTHORITATIVE EC2 DATA ONLY<br>NO SYNTHETIC BALANCES OR TRADES</div></div>
<div class="cards" id="cards"><div class="stat top empty"><div class="stat-label">PORTFOLIO EQUITY</div><div class="stat-value">—</div><div class="stat-foot">Awaiting verified balance</div></div><div class="stat top empty"><div class="stat-label">TOTAL TRADING P&amp;L</div><div class="stat-value">—</div><div class="stat-foot">No actual PAPER record</div></div><div class="stat top empty"><div class="stat-label">CASH / RESERVED SOL</div><div class="stat-value">—</div><div class="stat-foot">Awaiting account snapshot</div></div><div class="stat top empty"><div class="stat-label">ECONOMIC P&amp;L</div><div class="stat-value">—</div><div class="stat-foot">Operating costs not yet reported</div></div></div></section>
<section class="panel chart-panel" id="performance" aria-labelledby="performanceTitle">
<div class="panel-heading"><div><div class="section-index">02 / PERFORMANCE MONITOR</div><h2 id="performanceTitle">Portfolio P&amp;L trajectory</h2><p class="panel-sub" id="chartBasis">Awaiting the source-reported P&amp;L convention</p></div><div class="panel-tag" id="chartTag">HISTORY PENDING</div></div>
<div class="chart-shell"><svg id="chart" viewBox="0 0 900 280" role="img" aria-label="Portfolio trading profit and loss with explicit gaps for missing historical data"></svg></div>
<div class="chart-meta"><span id="freshness">No source, market, or reconciliation timestamps available.</span><span class="chart-legend" id="chartLegend">SOURCE P&amp;L / USD</span></div>
<div class="chart-controls"><span class="chart-window-label" id="chartWindowLabel">RECENT 24H · ZOOMED VALUE SCALE</span><button class="chart-range-toggle" id="chartRangeToggle" type="button" aria-pressed="false" hidden>View full history</button></div>
<div class="chart-note" id="chartNote">Actual observations only. Zero is the reference line; missing history is not treated as zero.</div>
</section>
<div class="two-up" id="activity"><section class="panel data-panel" aria-labelledby="positionsTitle"><div class="panel-heading"><div><div class="section-index">03 / EXPOSURE</div><h2 id="positionsTitle">Open positions</h2></div><div class="panel-tag" id="positionsCount">—</div></div><div id="positions"><div class="no-records"><strong>NO POSITION DATA</strong><span>Waiting for an authoritative PAPER portfolio snapshot.</span></div></div></section>
<section class="panel data-panel paper-trades-panel" aria-labelledby="tradesTitle"><details class="paper-trades-disclosure"><summary class="panel-heading paper-trades-summary" aria-controls="paperTradesBody"><div><div class="section-index">04 / EXECUTION LOG</div><h2 id="tradesTitle">Recent PAPER trades</h2></div><div class="paper-trades-actions"><div class="panel-tag" id="tradesCount">—</div><span class="paper-trades-icon" aria-hidden="true"></span></div></summary><div class="paper-trades-body" id="paperTradesBody"><h3 class="panel-sub">Pending orders and reservations</h3><div id="orders"><div class="no-records"><strong>PENDING ACTIONS UNAVAILABLE</strong><span>Waiting for verified order and reservation details.</span></div></div><h3 class="panel-sub">Completed PAPER executions</h3><div id="trades"><div class="no-records"><strong>NO TRADE DATA</strong><span>Execution records will appear after verified reporting begins.</span></div></div></div></details></section></div>
<div class="section-heading" id="system"><div><div class="section-index">05 / SYSTEM INTELLIGENCE</div><h2>Signal pipeline &amp; diagnostics</h2></div><div class="section-note">RAW VERIFIED COUNTS · NO INFERRED COVERAGE</div></div>
<div class="system-grid">
<section class="panel" aria-labelledby="funnelTitle"><div class="panel-heading"><div><div class="section-index">OPPORTUNITY FUNNEL</div><h2 id="funnelTitle">Candidate progression</h2></div><div class="panel-tag" id="funnelSource">AWAITING SOURCE</div></div><div id="funnel"><div class="no-records"><strong>NO VERIFIED COUNTS</strong><span>Discovery and qualification metrics are not yet reported.</span></div></div></section>
<section class="panel" aria-labelledby="metricsTitle"><div class="panel-heading"><div><div class="section-index">TELEMETRY</div><h2 id="metricsTitle">Runtime diagnostics</h2></div></div><div id="metrics"><div class="no-records"><strong>SYSTEM TELEMETRY PENDING</strong><span>Data coverage, lag, and budget indicators require actual EC2 observations.</span></div></div></section>
</div>
<section class="panel full-panel" aria-labelledby="decisionsTitle"><div class="panel-heading"><div><div class="section-index">06 / DECISION TRACE</div><h2 id="decisionsTitle">Evaluations &amp; refusals</h2></div><div class="panel-tag" id="decisionsCount">—</div></div><div id="decisions"><div class="no-records"><strong>NO DECISIONS REPORTED</strong><span>Verified decisions and rejection reasons will appear here.</span></div></div></section>
</main>
<footer class="footer"><div><strong>POE // </strong>FINANCIAL SOURCE OF TRUTH: EC2 · READ-ONLY PUBLIC VIEWER</div><div>PAPER OUTCOMES ARE SIMULATED · ECONOMIC EDGE UNPROVEN · LIVE EXECUTION DISABLED</div></footer>
</div></div>
<script>
'use strict';
const classifyOperatingSnapshot = ${operatingSnapshotFreshness.toString()};
const byId=id=>document.getElementById(id);
const money=n=>n===null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const put=(id,value)=>{byId(id).textContent=String(value)};
const add=(p,t,value,cls)=>{const n=document.createElement(t);if(value!==undefined)n.textContent=String(value);if(cls)n.className=cls;p.append(n);return n};
const makeSvg=(tag,attrs,txt)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(txt!==undefined)e.textContent=txt;return e};
let latest=null,latestReceivedAt=null,readFailure=null;
function renderCandidateIntelligence(){
 if(!latest){put('funnelSource','AWAITING SOURCE');put('decisionsCount','—');return;}
 const intelligence=latest.intelligence||null,isObserver=latest.source.strategy==='UNIMPLEMENTED_FLOW_BLOCKED'&&!intelligence;
 renderFunnel(latest.funnel,intelligence,isObserver);
 put('funnelSource',intelligence?'ORIGINAL ACCOUNT · '+intelligence.run.mode.toUpperCase():isObserver?'DISCOVERY OBSERVER · EVALUATION NOT CONNECTED':'AUTHORITATIVE RUNTIME');
 const financial=latest.decisions.map(d=>[d.at,'FINANCIAL',d.mint,d.stage,d.reason]);
 const predictive=intelligence?intelligence.decisions.map(d=>[d.at,'PREDICTIVE',d.mint,d.stage,d.reason]):[];
 const seen=new Set(),rows=[...financial,...predictive].filter(d=>{const key=d[0]+'|'+d[2]+'|'+d[3]+'|'+d[4];if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>Date.parse(b[0])-Date.parse(a[0])).slice(0,50);
 const refusals=intelligence?intelligence.refusals:[];refusals.forEach(d=>rows.push(['RUN TOTAL','DATA / RESOURCE','—',d.reason,String(d.count)]));
 put('decisionsCount',(financial.length+predictive.length)+' SOURCE DECISIONS · '+refusals.length+' REFUSAL TYPES');
 renderTable('decisions',['UTC','Scope','Mint','Stage','Reason'],rows,isObserver?'EVALUATION ENGINE NOT CONNECTED':'NO DECISIONS',isObserver?'The installed discovery observer has not been replaced by the unified trading engine. Downstream placeholders are not strategy rejections.':'No financial or independently verified predictive decision was reported in this source window.');
}

function signal(title,message,label,mode,time){put('stateTitle',title);put('state',message);put('sourceLabel',label);put('lastSync',time||'RECEIVER · AWAITING DATA');document.body.dataset.link=mode}
function clock(){put('utcClock',new Date().toISOString().slice(11,19)+' UTC')}
function renderCards(s){
 const b=s.balances,operating=!!s.intelligence;const data=[
 ['PORTFOLIO EQUITY',money(b.equityUsd),'Includes passive SOL/USD valuation',b.equityUsd],
 [operating?'TOKEN TRADING P&L':'EQUITY CHANGE FROM INCEPTION',money(b.tradingPnlUsd),operating?'Net token result translated at current SOL/USD':'Includes passive SOL/USD movement; not pure trading',b.tradingPnlUsd],
 ['CASH / RESERVED SOL',b.cashSol+' / '+b.reservedSol,'SOL · free cash / reservations',null],
 [operating?'TRADING AFTER OPERATING COSTS':'EQUITY CHANGE AFTER COSTS',money(b.economicPnlUsd),operating?'Current USD translation; unknown costs stay unavailable':'Includes passive SOL/USD movement',b.economicPnlUsd],
 ['REALIZED TRADING P&L',money(b.realizedUsd),'Realized PAPER outcomes',b.realizedUsd],
 ['UNREALIZED TRADING P&L',money(b.unrealizedUsd),'Based on available marks',b.unrealizedUsd],
 ['MODELED EXECUTION COSTS',money(b.executionCostsUsd),'Simulated transaction costs',null],
 ['OPERATING COSTS',money(b.operatingCostsUsd),'Cost evidence: '+s.costLabels.operating,null],
 ['POSITION COST / EXPOSURE',money(b.positionCostUsd)+' / '+money(b.markedExposureUsd),'USD · cost / marked exposure',null],
 ['DRAWDOWN',money(b.drawdownUsd),'USD · reported risk',null],
 ['PASSIVE SOL BENCHMARK',money(b.passiveSolEquityUsd),'Reference holding · SOL/USD exposure',null],
 ['INCEPTION REFERENCE',money(s.account.initialUsd),'Virtual starting capital',null]
 ];
 const p=byId('cards');p.replaceChildren();
 data.forEach(([label,value,foot,number],i)=>{const el=add(p,'div',undefined,'stat'+(i<4?' top':''));add(el,'div',label,'stat-label');const v=add(el,'div',value,'stat-value');if(String(value).length>24)v.classList.add('long');if(number!==null&&i!==0){if(number>0)v.classList.add('positive');if(number<0)v.classList.add('negative')}add(el,'div',foot,'stat-foot')});
}
function renderTable(id,heads,rows,emptyTitle,emptyBody){
 const p=byId(id);p.replaceChildren();
 if(!rows.length){const e=add(p,'div',undefined,'no-records');add(e,'strong',emptyTitle);add(e,'span',emptyBody);return}
 const wrap=add(p,'div',undefined,'table-wrap'),t=add(wrap,'table',undefined,'data-table'),h=add(t,'thead'),tr=add(h,'tr');
 heads.forEach(x=>add(tr,'th',x));const body=add(t,'tbody');
 rows.forEach(row=>{const r=add(body,'tr');row.forEach(cell=>add(r,'td',cell===null?'Unavailable':cell))});
}
function renderFunnel(f,intelligence=null,isObserver=false){
 const el=byId('funnel');el.replaceChildren();const outer=add(el,'div',undefined,'funnel-grid');
 const row=(key,label,value)=>{const line=add(outer,'div',undefined,'funnel-line');line.dataset.funnelStage=key;add(line,'div',label,'funnel-name');const track=add(line,'div',undefined,'funnel-track'),fill=add(track,'div',undefined,'funnel-fill');fill.style.width='0%';add(line,'div',value===null||value===undefined?'Unavailable':typeof value==='number'?value.toLocaleString('en-US'):String(value),'funnel-count');};
 if(intelligence){
  const c=intelligence.candidates;
  const candidateRows=[['migrationsReceived','Migrations received'],['known','Known market identities'],['watch','Lightweight watch'],['eligible','Eligible watch'],['queued','Waiting for deep observation'],['auditedWindows','Audited usable windows'],['uniqueAudited','Unique tokens audited'],['predictiveAssessments','Predictive assessments'],['predictivePasses','Predictive passes'],['predictiveFailures','Predictive failures']];
  const financialRows=[['qualified','Executable qualifications'],['attempted','PAPER attempts'],['paperFilled','PAPER fills'],['exited','PAPER exits']];
  const numeric=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const ceiling=Math.max(1,...candidateRows.map(([key])=>numeric(c[key])??0),...financialRows.map(([key])=>numeric(f[key])??0));
  const plotted=(key,label,value)=>{
   row(key,label,value);
   const count=numeric(value),fill=outer.lastElementChild.querySelector('.funnel-fill');
   fill.style.width=count===null?'0%':(100*count/ceiling).toFixed(2)+'%';
  };
  candidateRows.forEach(([key,label])=>plotted(key,label,c[key]));
  const active=numeric(c.deepActive),maximum=numeric(c.deepMaximum);
  row('deepActive','Deep-analysis slots',(active===null?'?':active)+' / '+(maximum===null?'?':maximum));
  if(active!==null&&maximum!==null&&maximum>0)outer.lastElementChild.querySelector('.funnel-fill').style.width=(100*Math.min(active,maximum)/maximum).toFixed(2)+'%';
  financialRows.forEach(([key,label])=>plotted(key,label,f[key]));
  add(el,'p','Bars show counts relative to the largest reported stage; deep-analysis slots show occupancy. Window and assessment totals may span source recoveries; unique tokens are counted within the current source generation. Overlapping windows are not independent coverage. A market-wide denominator has not been established.','panel-sub');
 }else{
  const fields=[['discovered','Discovered'],['supported','Supported'],['sufficientlyObserved','Sufficiently observed'],['evaluated','Financial evaluations'],['qualified','Qualified'],['attempted','Attempted'],['paperFilled','PAPER filled'],['exited','Exited'],['reconciled','Reconciled']];
  // Rank legacy event frequency; retain source order for ties and leave missing counts unavailable.
  const ranked=fields.map(([key,label],index)=>({key,label,index,count:Number.isSafeInteger(f[key])&&f[key]>=0?f[key]:null})).sort((a,b)=>a.count===null?(b.count===null?a.index-b.index:1):b.count===null?-1:b.count-a.count||a.index-b.index);
  const ceiling=Math.max(1,...ranked.map(item=>item.count??0));
  ranked.forEach(({key,label,count})=>{
   row(key,label,isObserver&&key!=='discovered'?'NOT ACTIVE':count===null?'Not reported':count);
   const line=outer.lastElementChild;
   if(isObserver&&key!=='discovered')line.classList.add('inactive-stage');
   else line.querySelector('.funnel-fill').style.width=count===null?'0%':(100*count/ceiling).toFixed(2)+'%';
  });
 }
}
function renderMetrics(m,source,intelligence=null){
 const p=byId('metrics');p.replaceChildren();
 const group=(title,items)=>{add(p,'h3',title,'panel-sub');const grid=add(p,'div',undefined,'metric-grid');items.forEach(([label,value])=>{const e=add(grid,'div',undefined,'metric');add(e,'div',label,'metric-name');add(e,'div',value===null||value===undefined?'Unavailable':String(value),'metric-value');});};
 group('Source-reported market evidence', [['Market coverage',m.coverage],['Latency evidence',m.latency],['Processing lag (ms)',m.processingLagMs],['Event-loop lag (ms)',m.eventLoopLagMs],['Provider events',m.providerEvents],['RPC operations',m.rpcRequests],['Projected data SOL/day',m.projectedDailyDataSol],['Data budget SOL',m.budgetRemainingSol],['Budget status',m.budgetStatus],['Runtime release',source.release],['Strategy version',source.strategy]]);
 if(!intelligence)return;
 const c=intelligence.candidates,q=intelligence.quality,u=intelligence.provider,r=intelligence.resources,h=intelligence.protection,t=intelligence.times;
 group('Selection and completeness',[['Current run',intelligence.run.id],['Run started',intelligence.run.startedAt],['Promotions / re-promotions',String(c.promoted??'?')+' / '+String(c.repromoted??'?')],['Mean / maximum slot wait (ms)',String(c.waitMeanMs??'?')+' / '+String(c.waitMaximumMs??'?')],['Older tokens retained',c.olderSelected],['Audit unavailable / unusable',String(q.auditUnavailable??'?')+' / '+String(q.auditUnusable??'?')],['Data gaps',q.qualityGaps],['Decision deadline failures',q.decisionDeadlineMisses],['Incomplete / capacity exclusions',String(q.incompleteExclusions??'?')+' / '+String(q.capacityExclusions??'?')],['Enrichment deadline failures',q.enrichmentDeadlineFailures]]);
 group('Provider and resource health',[['Selected capture connected',q.captureConnected],['Migration / watch connected',String(u.discoveryConnected??'?')+' / '+String(u.watchConnected??'?')],['Accounted RPC response bytes',u.rpcResponseBytes],['Native / broad-stream bytes',String(u.nativeStreamBytes??'?')+' / '+String(u.broadWatchBytes??'?')],['HTTP timeouts / errors',String(u.httpTimeouts??'?')+' / '+String(u.httpErrors??'?')],['Throttles',u.throttles],['Rolling starts / per-minute limit',String(u.rollingStartsPerMinute??'?')+' / '+String(u.maximumStartsPerMinute??'?')],['Primary / history cooldown',String(u.primaryCooldownUntil??'None reported')+' / '+String(u.historyCooldownUntil??'None reported')],['Resource state',r.state],['Resource sample time',r.sampleAt],['CPU use (one core)',r.cpuOneCoreFraction===null?null:(100*r.cpuOneCoreFraction).toFixed(1)+'%'],['Resident memory (bytes)',r.rssBytes],['Available RAM / disk (bytes)',String(r.availableMemoryBytes??'?')+' / '+String(r.availableDiskBytes??'?')]]);
 const a=intelligence.admission;
 group('Admission and recovery',a?[['Financial projection ready',a.financialProjectionReady],['Reporting supervision permits new risk',a.supervisedNewRiskAllowed],['CPU / memory / disk admission',a.candidateResourceAdmissionAllowed],['Evidence admission',a.evidenceAdmissionAllowed],['Evidence pressure',a.evidencePressureReasonCode],['Diagnostic bytes / rolling limit',String(a.evidenceDiagnosticBytes??'?')+' / '+String(a.evidenceDiagnosticLimitBytes??'?')],['Essential evidence recovery required',a.evidenceRequiresCriticalRecovery],['Evidence refusals',a.evidenceRefusedRecords],['Source recovery generation / failures',String(a.sourceRecoveryGeneration??'?')+' / '+String(a.sourceRecoveryFailures??'?')],['Source recovery reason',a.sourceRecoveryReasonCode],['Source recovery retry time',a.sourceRecoveryRetryAt],['Previous transports settled',a.sourceRecoveryClosingSettled],['Source restart required',a.sourceRestartRequired],['Entry proof preparation',a.proofPreparationState]]:[['Admission / recovery detail',null]]);
 group('Position protection',[['Current protection',h.state],['Last completed evaluation',h.lastCompletedAt],['Target cadence (ms)',h.targetCadenceMs],['Measured maximum evaluation gap (ms)',h.maximumCompletedGapMs],['Maximum quote age at use (ms)',h.maximumQuoteAgeAtUseMs],['Protection failures / unavailable checks',String(h.breaches??'?')+' / '+String(h.unavailableChecks??'?')],['Last market notification',t.marketNotificationAt],['Last fresh support / bank Clock',String(t.freshSupportAt??'Unavailable')+' / '+String(t.bankClockAt??'Unavailable')],['Last independent audit / predictive assessment',String(t.auditAt??'Unavailable')+' / '+String(t.predictiveAt??'Unavailable')],['Financial reconciliation',t.reconciliationAt]]);
 q.limitations.forEach(note=>add(p,'p',note,'panel-sub'));
}

let chartRange='recent';
/** A same-time null placeholder does not erase a verified trading value.
 * Missing values at distinct timestamps and conflicting duplicate values remain gaps. */
function tradingPnlTimeline(points){
 const timeline=[];
 for(const point of points){
  const prior=timeline[timeline.length-1];
  if(prior&&prior.at===point.at){
   if(point.tradingUsd!==null&&!prior.conflict){
    if(prior.tradingUsd!==null&&prior.tradingUsd!==point.tradingUsd){prior.tradingUsd=null;prior.conflict=true;}
    else prior.tradingUsd=point.tradingUsd;
   }
  }else timeline.push({at:point.at,tradingUsd:point.tradingUsd,conflict:false});
 }
 return timeline;
}
function plot(points){
 const root=byId('chart');root.replaceChildren();
 const width=Math.max(305,Math.min(960,Math.floor(root.parentElement.clientWidth||900)));
 const height=280;root.setAttribute('viewBox','0 0 '+width+' '+height);
 const left=width<500?58:77,right=width-20,top=20,bottom=height-34;
 for(let i=0;i<5;i++){const yy=top+(bottom-top)*i/4;root.append(makeSvg('line',{x1:left,y1:yy,x2:right,y2:yy,stroke:'rgba(118,167,207,.15)','stroke-dasharray':'3 6'}))}
 const timeline=tradingPnlTimeline(points),latestAt=timeline.length?Date.parse(timeline[timeline.length-1].at):0;
 const recentCutoff=latestAt-24*60*60*1000,recent=timeline.filter(p=>Date.parse(p.at)>=recentCutoff);
 const recentReady=recent.filter(p=>p.tradingUsd!==null).length>=2;
 const hasEarlier=timeline.some(p=>Date.parse(p.at)<recentCutoff);
 const focused=chartRange==='recent'&&recentReady;
 const visible=focused?recent:timeline;
 const rangeToggle=byId('chartRangeToggle');
 rangeToggle.hidden=!hasEarlier||!recentReady;
 rangeToggle.textContent=chartRange==='all'?'View recent 24h':'View full history';
 rangeToggle.setAttribute('aria-pressed',String(chartRange==='all'));
 put('chartWindowLabel',focused?'RECENT 24H · ZOOMED VALUE SCALE':'FULL REPORTED HISTORY · ZERO-BASED SCALE');
 const valid=visible.filter(p=>p.tradingUsd!==null);
 if(!valid.length){
  root.append(makeSvg('text',{x:width/2,y:127,'text-anchor':'middle',fill:'#9dc5d9','font-size':width<420?13:15,'font-weight':650,'letter-spacing':1},'NO VERIFIED P&L SERIES'));
  root.append(makeSvg('text',{x:width/2,y:153,'text-anchor':'middle',fill:'#637e9f','font-size':11},'Chart will populate from actual PAPER history'));
  return;
 }
 const from=Date.parse(visible[0].at),end=Math.max(from+1,Date.parse(visible[visible.length-1].at));
 const values=valid.map(p=>p.tradingUsd),smallest=Math.min(...values),largest=Math.max(...values);
 let low,high;
 if(focused){
  const center=(smallest+largest)/2,half=Math.max((largest-smallest)*.62,.015,Math.abs(center)*.0025);
  low=center-half;high=center+half;
 }else{
  low=Math.min(0,smallest);high=Math.max(0,largest);
  const span=Math.max(.01,high-low);low-=span*.14;high+=span*.14;
 }
 const x=at=>left+(Date.parse(at)-from)/(end-from)*(right-left),y=n=>bottom-(n-low)/(high-low)*(bottom-top);
 const precision=high-low<.02?4:high-low<.2?3:high-low<10?2:0;
 const fmt=n=>(n<0?'−$':'$')+Math.abs(n).toFixed(precision);
 for(let i=0;i<5;i++){const value=high-(high-low)*i/4;root.append(makeSvg('text',{x:left-7,y:top+(bottom-top)*i/4+4,'text-anchor':'end',fill:'#a4b9d2','font-size':10},fmt(value)))}
 if(low<=0&&high>=0)root.append(makeSvg('line',{x1:left,y1:y(0),x2:right,y2:y(0),stroke:'#6489a5','stroke-dasharray':'5 4','stroke-width':1}));
 let group=[];
 const flush=()=>{
  if(!group.length)return;
  if(group.length>1){
   const d=group.map((p,i)=>(i?'L':'M')+x(p.at).toFixed(2)+' '+y(p.tradingUsd).toFixed(2)).join(' ');
   root.append(makeSvg('path',{'data-chart-series':'trading-pnl-line',d,stroke:'#90f7df','stroke-width':3.2,fill:'none','stroke-linecap':'round','stroke-linejoin':'round'}));
  }
  const last=group[group.length-1];
  root.append(makeSvg('circle',{'data-chart-point':'last-verified',cx:x(last.at),cy:y(last.tradingUsd),r:3.4,fill:'#d4fff7',stroke:'#07121e','stroke-width':1.3}));
  group=[];
 };
 for(const point of visible){
  if(point.tradingUsd===null){flush();continue;}
  if(group.length&&Date.parse(point.at)-Date.parse(group[group.length-1].at)>90000)flush();
  group.push(point);
 }
 flush();
 root.append(makeSvg('text',{x:left,y:height-12,fill:'#9bacc5','font-size':10},new Date(from).toISOString().slice(5,16).replace('T',' ')+' UTC'));
 root.append(makeSvg('text',{x:right,y:height-12,'text-anchor':'end',fill:'#9bacc5','font-size':10},new Date(end).toISOString().slice(5,16).replace('T',' ')+' UTC'));
}
function showSnapshot(s,received,f){
 latest=s;latestReceivedAt=received;readFailure=null;
 renderCards(s);
 put('positionsCount',s.positions.length+' REPORTED');
 put('tradesCount',s.trades.length+' REPORTED');
 renderTable('positions',['Token / quantity','Entry / net liquidation','Costs','Status'],s.positions.map(p=>[p.label+' · '+p.mint+' / '+p.quantity,money(p.entryCostUsd)+' / '+money(p.netLiquidationUsd),money(p.executionCostsUsd),p.status]),'NO OPEN POSITIONS','No positions in the current published window.');
 renderTable('trades',['UTC / side','Token / quantity','Value / costs','Status / reason'],s.trades.map(t=>[t.at+' / '+t.side,t.mint+' / '+t.quantity,money(t.valueUsd)+' / '+money(t.executionCostsUsd),t.status+' · '+t.reason]),'NO PAPER TRADES','No trades in the current published window.');
 renderCandidateIntelligence();renderMetrics(s.metrics,s.source,s.intelligence||null);plot(s.pnl);
 put('chartBasis',s.intelligence?'Net token trading result translated at current SOL/USD; not historical realized USD profit':'Legacy equity change includes passive SOL/USD; do not interpret as pure trading profit');put('chartLegend',s.intelligence?'TOKEN TRADING · CURRENT USD':'LEGACY EQUITY CHANGE · USD');
 const orders=s.intelligence?s.intelligence.pendingOrders:[];renderTable('orders',['Decision / side','Token / minimum receive','Reserved SOL','Execution / expiry'],orders.map(o=>[o.decidedAt+' / '+o.side,o.mint+' / '+o.quantityMinimum,o.reservedSol,o.executeAt+' / '+o.expiresAt]),s.intelligence?'NO PENDING ORDERS':'PENDING-ACTION DETAIL UNAVAILABLE',s.intelligence?'No unresolved orders or reservations were reported by this account.':'This source does not publish order-level details. Missing detail does not establish that no action is pending.');
 put('chartTag',s.pnl.some(p=>p.tradingUsd!==null)?'VERIFIED P&L LINE':'HISTORY UNAVAILABLE');
 put('freshness','Generated '+s.times.generatedAt+(s.intelligence?' · Financial valuation ':' · Market ')+(s.times.marketAt||'unavailable')+' · Reconciled '+(s.times.reconciledAt||'unavailable')+' · Receiver '+received);
 put('chartNote',s.history.label+' · '+s.pnl.length+'/720 points · '+(s.history.downsampled?'downsampled':'as recorded')+' · window start '+(s.history.windowStartAt||'unavailable')+'. Missing samples remain gaps. Line segments connect consecutive verified trading observations only; no missing values are interpolated.');
 if(!s.intelligence){
  const state=String(f.state).toUpperCase();
  const bad=f.state==='stale'||f.state==='unavailable';
  signal(state+' · '+s.status.market.toUpperCase(),'PAPER entries '+s.status.entries+' · runtime '+s.status.runtime+(s.status.blocker?' · Blocker: '+s.status.blocker:'')+' · source '+s.account.id+' · sequence '+s.sequence, bad?'CHECK SOURCE FRESHNESS':'VERIFIED SNAPSHOT RECEIVED',bad?'warning':'connected','RECEIVER · '+received);
 }
 byId('exportLink').hidden=false;
 paintFreshness();
}
let refreshInFlight=false;
async function refresh(){
 if(refreshInFlight)return;
 refreshInFlight=true;
 try{
  const resp=await fetch('/api/snapshot',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});
  if(!resp.ok)throw new Error(resp.status===503?'SOURCE_NOT_CONFIGURED':'REPORTING_HTTP_'+resp.status);
  const result=await resp.json();
  if(!result||!result.snapshot||!result.freshness)throw new Error('SNAPSHOT_UNAVAILABLE');
  showSnapshot(result.snapshot,result.receivedAt,result.freshness);
 }catch(error){
  const reason=error instanceof Error?error.message:'REPORTING_UNAVAILABLE';
  readFailure=reason;
  if(reason==='SOURCE_NOT_CONFIGURED'){if(!latest)signal('Awaiting authoritative data','No verified EC2 snapshot is configured. This dashboard will not fabricate balances, charts, or trades.','SOURCE NOT CONNECTED','pending');else signal('Source reporting unavailable','Last received data is retained for inspection, but current source configuration is unavailable.','SOURCE UNAVAILABLE','warning')}
  else{signal(latest?'Data link interrupted':'Reporting unavailable',latest?'Last received snapshot remains displayed; do not treat it as current.':'Unable to obtain a verified source snapshot. Portfolio values remain unavailable.',reason,'error')}
  paintFreshness();
 }finally{refreshInFlight=false}
}
document.querySelectorAll('.rail-link').forEach(link=>link.addEventListener('click',()=>{document.querySelectorAll('.rail-link').forEach(n=>n.classList.remove('selected'));link.classList.add('selected')}));
function paintFreshness(){
 if(!latest)return;
 const operating=latest.intelligence?classifyOperatingSnapshot(latest,latestReceivedAt,Date.now()):null;
 if(operating){
  const stale=operating.state==='stale',stopped=latest.status.runtime==='stopped';
  if(readFailure){signal('Data link interrupted'+(stale?' · STALE SOURCE SNAPSHOT':stopped?' · STOPPED':''),'Browser snapshot read failed ('+readFailure+'). Last received data is retained for inspection; do not treat it as current. Runtime '+latest.status.runtime+' · account '+latest.account.id,'DASHBOARD READ FAILED','error','RECEIVER · '+latestReceivedAt);return;}
  const messages={SOURCE_STALE:'Source snapshot is over 90 seconds old',PUBLISHER_STALE:'No accepted publisher delivery within 90 seconds',RUNTIME_STOPPED:'Runtime stopped; positions and unresolved actions remain as reported',RUNTIME_UNAVAILABLE:'Runtime reports unavailable',SELECTED_CAPTURE_LOST:'Selected-candidate capture is disconnected; valid observation is interrupted',SELECTED_CAPTURE_UNKNOWN:'Selected-candidate capture status is unavailable',DISCOVERY_LOST:'Broad migration discovery is disconnected',DISCOVERY_UNKNOWN:'Broad migration discovery status is unavailable',WATCH_LOST:'Lightweight watch activity is disconnected',WATCH_UNKNOWN:'Lightweight watch activity status is unavailable',USD_VALUATION_UNAVAILABLE:'USD valuation is unavailable; financial amounts remain unavailable',VALUATION_UNAVAILABLE:'Current financial valuation timestamp is unavailable',VALUATION_STALE:'Financial valuation timestamp is over 90 seconds old',RECONCILIATION_NOT_CURRENT:'Financial reconciliation is not current; entry permission remains as reported',RECONCILIATION_UNAVAILABLE:'Financial reconciliation timestamp is unavailable',RECONCILIATION_STALE:'Financial reconciliation timestamp is over 90 seconds old',PROTECTION_UNAVAILABLE:'Held-position protection is unavailable as of this source snapshot',PROTECTION_DEGRADED:'Held-position protection is degraded as of this source snapshot',PROTECTION_OVERDUE:'Held-position protection exceeded its reported completion boundary at source generation',EVIDENCE_PRESSURE:'Evidence pressure restricts candidate admission',RESOURCE_PRESSURE:'Resource pressure restricts candidate admission',SOURCE_RECOVERY:'Candidate-source recovery is pending',ENTRY_READINESS_REQUIRED:'Fresh financial reconciliation and runtime readiness are required before entries',CURRENT_ENTRY_GATE_NOT_SATISFIED:'Current entry gates are not satisfied; the source retains a prior readiness reason',OWNER_ENTRY_PAUSE:'The owner paused new entries',SAFE_STOP_REQUESTED:'A safe stop was requested; existing obligations remain',OTHER_SOURCE_RESTRICTION:'New entries are restricted by another source-reported condition',POE_ENTRY_MANUAL_PAUSE:'The owner paused new entries',POE_ENTRY_SAFE_STOP:'A safe stop is active; existing obligations remain',POE_ENTRY_DAILY_LOSS:'The daily loss protection restricts new entries',POE_ENTRY_FINANCIAL_UNCERTAINTY:'Financial state or an order outcome is unresolved; new entries remain closed',POE_ENTRY_EVIDENCE_UNAVAILABLE:'Required trading evidence is unavailable; new entries remain closed',POE_ENTRY_USD_UNAVAILABLE:'A fresh SOL/USD price is unavailable; new entries remain closed',POE_ENTRY_LIQUIDATION_UNAVAILABLE:'Fresh actual-size liquidation pricing is unavailable',POE_ENTRY_RECONCILIATION_REQUIRED:'Financial reconciliation has not completed for the current account day',POE_ENTRY_RECONCILIATION_STALE:'Financial reconciliation exceeds the two-second entry boundary',POE_ENTRY_PROVIDER_UNAVAILABLE:'Provider access is unavailable or recovering; new entries remain closed',POE_ENTRY_SOURCE_UNAVAILABLE:'Required market observation is unavailable or recovering',POE_ENTRY_MONITORING_UNAVAILABLE:'New-entry monitoring or shared RPC capacity is temporarily reserved; position safeguards remain enforced.',POE_ENTRY_READINESS_REQUIRED:'Fresh complete audited market evidence and financial readiness are required',POE_ENTRY_FINANCIAL_PAUSED:'The ledger entry control is paused; verified recovery is still required'};
  const warnings=operating.reasonCodes.map(code=>messages[code]).filter(Boolean);
  const capture=operating.market==='unavailable'?'SELECTED CAPTURE UNAVAILABLE':operating.market==='unknown'?'CAPTURE UNKNOWN':operating.market.toUpperCase();
  let title=latest.status.runtime==='running'?'RUNNING · '+capture:latest.status.runtime.toUpperCase();
  if(stale)title=(stopped?'STOPPED · ':'')+'STALE SOURCE SNAPSHOT';
  else if(operating.reasonCodes.includes('PROTECTION_UNAVAILABLE'))title+=' · PROTECTION UNAVAILABLE';
  else if(operating.reasonCodes.includes('PROTECTION_OVERDUE'))title+=' · PROTECTION OVERDUE';
  const discovery=operating.selectedCapture===false&&operating.discovery===true?' · Broad discovery continues':'';
  const detail='PAPER entries '+latest.status.entries+' · source reporting '+operating.reporting+discovery+(warnings.length?' · '+warnings.join(' · '):'')+' · account '+latest.account.id+' · sequence '+latest.sequence;
  signal(title,detail,stale?'CHECK SOURCE FRESHNESS':stopped?'MONITORING INTERRUPTED':warnings.length?'SOURCE CURRENT · WARNINGS':'SOURCE CURRENT',warnings.length||stale?'warning':'connected','RECEIVER · '+latestReceivedAt);
  return;
 }
 const age=at=>at===null?0:Math.max(0,Date.now()-Date.parse(at));
 const stale=Math.max(age(latest.times.generatedAt),age(latest.times.marketAt),age(latest.times.reconciledAt))>90000;
 const stopped=latest.status.runtime==='stopped';
 if(readFailure){signal('Data link interrupted'+(stale?' · STALE SOURCE SNAPSHOT':stopped?' · STOPPED':''),'Browser snapshot read failed ('+readFailure+'). Last received data is retained for inspection; do not treat it as current. Runtime '+latest.status.runtime+' · account '+latest.account.id,'DASHBOARD READ FAILED','error','RECEIVER · '+latestReceivedAt);return;}
 if(stale)signal('STALE SOURCE SNAPSHOT','Last verified source is retained; market or financial information is no longer current. PAPER entries '+latest.status.entries+' · runtime '+latest.status.runtime+' · account '+latest.account.id,'CHECK SOURCE FRESHNESS','warning','RECEIVER · '+latestReceivedAt);
 else if(stopped)signal('STOPPED','Runtime stopped. Positions and unresolved actions remain as reported; no liquidation is inferred. Account '+latest.account.id,'MONITORING INTERRUPTED','warning','RECEIVER · '+latestReceivedAt);
}
clock();setInterval(()=>{clock();paintFreshness()},1000);plot([]);refresh();setInterval(refresh,15000);
window.addEventListener('focus',()=>{void refresh()});document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh()});
byId('refreshNow').addEventListener('click',()=>{void refresh()});
byId('chartRangeToggle').addEventListener('click',()=>{chartRange=chartRange==='recent'?'all':'recent';plot(latest?latest.pnl:[]);});
window.addEventListener('resize',()=>plot(latest?latest.pnl:[]));

/** UI-only progressive disclosure. All projections, API endpoints and financial boundaries are unchanged. */
(function compactCommandView(){
 'use strict';
 const one=selector=>document.querySelector(selector);
 const panelFold=(selector,description)=>{
  const panel=one(selector);if(!panel||panel.classList.contains('compact-folded'))return;
  const heading=panel.querySelector('.panel-heading');if(!heading||heading.parentElement!==panel)return;
  const details=document.createElement('details');details.className='compact-disclosure';
  const summary=document.createElement('summary');summary.textContent=description;
  const body=document.createElement('div');body.className='compact-disclosure-body';
  while(heading.nextSibling)body.append(heading.nextSibling);
  details.append(summary,body);panel.append(details);panel.classList.add('compact-folded');
 };
 const metricToggle=(panelId,gridId,description)=>{
  const panel=document.getElementById(panelId),grid=document.getElementById(gridId);
  if(!panel||!grid)return;
  const button=document.createElement('button');button.type='button';button.className='compact-toggle';
  button.setAttribute('aria-controls',gridId);button.setAttribute('aria-expanded','false');
  const update=()=>{const expanded=panel.classList.contains('compact-expanded');button.textContent=(expanded?'Show key figures only':'Show all '+description);button.setAttribute('aria-expanded',String(expanded));};
  button.addEventListener('click',()=>{panel.classList.toggle('compact-expanded');update();});
  grid.after(button);update();
 };
 const status=one('section.status-strip'),hero=one('section.hero');
 if(status&&hero){const artworkCaption=hero.nextElementSibling;if(artworkCaption?.classList.contains('holo-index'))artworkCaption.after(status);else hero.after(status);}
 const portfolio=document.getElementById('portfolio');
 if(status){
  const nav=document.createElement('nav');nav.className='compact-quick-links';nav.setAttribute('aria-label','Jump to dashboard sections');
  for(const [href,label] of [['#portfolio','Portfolio'],['#performance','P&L trajectory'],['#activity','PAPER orders and trades'],['#system','Candidates'],['#reporting-status','System health']]){
   if(!document.querySelector(href))continue;
   const link=document.createElement('a');link.href=href;link.textContent=label;nav.append(link);
  }
  status.after(nav);
 }
 // Key figures stay visible; refreshes rebuild only their contents, not these controls.
 metricToggle('portfolio','cards','portfolio metrics');
 panelFold('section[aria-labelledby="metricsTitle"]','Runtime metrics and provider usage');
 panelFold('section[aria-labelledby="decisionsTitle"]','Full evaluation decisions and refusal reasons');
 document.body.classList.add('poe-compact-view');
 // Side-rail navigation opens the requested disclosure without hiding its destination.
 document.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',()=>{
  const id=link.getAttribute('href');if(!id)return;
  const dest=document.getElementById(id.slice(1)),details=dest&&dest.querySelector('.compact-disclosure');
  if(id==='#activity'){const paperTrades=dest&&dest.querySelector('.paper-trades-disclosure');if(paperTrades)paperTrades.open=true;}
  if(details&&dest.classList.contains('compact-folded'))details.open=true;
 }));
})();

</script>
</body></html>`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`required configuration missing: ${name}`); return value; };
  const port = Number(process.env.PORT ?? 10000);
  if((process.env.POE_ACCOUNT_ID||process.env.POE_INCEPTION_AT)&&(process.env.POE_ACCOUNT_ID!==ORIGINAL_POE_ACCOUNT||process.env.POE_INCEPTION_AT!==ORIGINAL_POE_INCEPTION))throw Error('original POE account and inception required');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('invalid PORT');
  const { server } = createDashboard({
    accountId: process.env.POE_ACCOUNT_ID, inceptionAt: process.env.POE_INCEPTION_AT,
    release: process.env.POE_RUNTIME_RELEASE, strategy: process.env.POE_STRATEGY_VERSION,
    viewerUser: process.env.POE_VIEWER_USER ?? '', viewerPassword: process.env.POE_VIEWER_PASSWORD ?? '',
    publicViewer: process.env.POE_PUBLIC_VIEWER === 'true', ingestionSecret: required('POE_INGEST_SECRET'),
  });
  server.listen(port, '0.0.0.0', () => process.stdout.write(`poe-dashboard listening on ${port}; awaiting authenticated source\n`));
}
