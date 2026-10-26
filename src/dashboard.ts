import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MAX_SNAPSHOT_BYTES, SnapshotCache, type ReportingIdentity } from './reporting.js';

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
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    const path = req.url?.split('?')[0];
    if (path === '/healthz' && req.method === 'GET') { send(res, 200, { ok: true, service: 'poe-dashboard' }); return; }
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
    res.end(HTML);
  });
  server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 100;
  return { server, cache };
}

const HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>POE · PAPER opportunity engine</title>
<style>
:root{color-scheme:dark;font:15px system-ui,sans-serif;background:#0b1018;color:#dce6f3}*{box-sizing:border-box}body{margin:0 auto;max-width:1120px;padding:22px}h1{font-size:26px;letter-spacing:-.03em;margin:0}h2{font-size:18px;margin:24px 0 14px}.muted{color:#95a8be;font-size:13px;line-height:1.6}.pill{display:inline-block;border:1px solid #3b536e;background:#162739;border-radius:20px;padding:5px 12px;font-size:12px;letter-spacing:.04em}.banner{border-left:3px solid #83b3ff;padding:10px 14px;background:#142033;margin:20px 0;white-space:pre-wrap}.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{padding:16px;background:#131e2b;border:1px solid #253547;border-radius:10px}.value{font-size:24px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums;margin-top:7px}.label{color:#a6bad1;font-size:12px}.chart{background:#101a27;border:1px solid #253547;border-radius:10px;padding:12px;margin-top:20px}svg{width:100%;height:auto;display:block}.scroller{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #253547;vertical-align:top}th{color:#a6bad1;font-weight:500}td{overflow-wrap:anywhere;max-width:250px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px ui-monospace,monospace;line-height:1.7;color:#b9cbe0}a{color:#a2c8ff}footer{margin:30px 0}.small{font-size:11px} @media(max-width:700px){body{padding:14px}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}.value{font-size:21px}h1{font-size:23px}}
</style></head><body>
<header><span class="pill">PAPER · LIVE DISABLED</span><h1 style="margin-top:12px">Pump Opportunity Engine</h1><div id="identity" class="muted">Awaiting POE data</div></header>
<div id="state" class="banner" role="status">Awaiting POE data</div>
<main id="content" hidden>
<section aria-labelledby="overview"><h2 id="overview">Overview</h2><div id="cards" class="cards"></div>
<div id="freshness" class="muted" style="margin-top:14px"></div>
<div class="chart"><div class="label">TOTAL PORTFOLIO TRADING P&amp;L · USD · AFTER MODELED EXECUTION COSTS</div><svg id="chart" viewBox="0 0 900 250" role="img" aria-label="Portfolio trading profit and loss with genuine missing-data gaps"></svg><div id="chartNote" class="muted"></div><div class="muted">Zero reference shown. Operating costs are excluded from this line and reported separately above. Time: UTC.</div></div></section>
<section><h2>Positions</h2><div id="positions" class="scroller"></div><h2>Recent paper trades</h2><div id="trades" class="scroller"></div></section>
<section><h2>Opportunity &amp; system</h2><div class="grid"><div class="card"><div class="label">FUNNEL</div><pre id="funnel"></pre></div><div class="card"><div class="label">RUNTIME, DATA &amp; BUDGET</div><pre id="metrics"></pre></div></div><h2>Recent decisions / refusals</h2><div id="decisions" class="scroller"></div></section>
</main><footer class="muted">EC2 is the financial authority. This service is a replaceable read-only cache. PAPER outcomes are simulated; economic edge remains UNPROVEN. <a href="/api/export">Export bounded snapshot</a></footer>
<script>
'use strict';
const byId=id=>document.getElementById(id), money=n=>n===null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
function add(parent,tag,value,cls){const n=document.createElement(tag);if(value!==undefined)n.textContent=String(value);if(cls)n.className=cls;parent.append(n);return n}
function card(label,value){const n=add(byId('cards'),'div',undefined,'card');add(n,'div',label,'label');add(n,'div',value,'value')}
function table(id,heads,rows){const p=byId(id);p.replaceChildren();if(!rows.length){add(p,'p','No records in the published window.','muted');return}const t=add(p,'table'),h=add(t,'thead'),hr=add(h,'tr');heads.forEach(x=>add(hr,'th',x));const body=add(t,'tbody');rows.forEach(row=>{const tr=add(body,'tr');row.forEach(v=>add(tr,'td',v===null?'Unavailable':v))})}
function svg(tag,attrs,text){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,String(v)));if(text!==undefined)e.textContent=text;return e}
function chart(points){const root=byId('chart'),w=Math.max(420,Math.min(900,root.clientWidth||900));root.setAttribute('viewBox','0 0 '+w+' 250');root.replaceChildren();const valid=points.filter(p=>p.tradingUsd!==null);if(!valid.length){root.append(svg('text',{x:30,y:110,fill:'#95a8be','font-size':16},'No recorded trading P&L history available.'));return}const from=Date.parse(points[0].at),to=Math.max(from+1,Date.parse(points[points.length-1].at));let low=Math.min(0,...valid.map(p=>p.tradingUsd)),high=Math.max(0,...valid.map(p=>p.tradingUsd));if(high===low){low-=1;high+=1}const x=at=>50+(Date.parse(at)-from)/(to-from)*(w-70),y=n=>210-(n-low)/(high-low)*180;root.append(svg('line',{x1:50,x2:w-20,y1:y(0),y2:y(0),stroke:'#60758b','stroke-dasharray':'4 4'}));root.append(svg('text',{x:5,y:y(0)+4,fill:'#95a8be','font-size':12},'$0'));let path='';points.forEach(p=>{if(p.tradingUsd===null){if(path)root.append(svg('path',{d:path,fill:'none',stroke:'#83b3ff','stroke-width':2}));path='';return}path+=(path?' L':'M')+x(p.at)+' '+y(p.tradingUsd);root.append(svg('circle',{cx:x(p.at),cy:y(p.tradingUsd),r:2,fill:'#83b3ff'}))});if(path)root.append(svg('path',{d:path,fill:'none',stroke:'#83b3ff','stroke-width':2}));root.append(svg('text',{x:50,y:240,fill:'#95a8be','font-size':11},new Date(from).toISOString().slice(11,19)+' UTC'));root.append(svg('text',{x:w-20,y:240,'text-anchor':'end',fill:'#95a8be','font-size':11},new Date(to).toISOString().slice(11,19)+' UTC'))}
async function refresh(){try{const r=await fetch('/api/snapshot',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(4000)});if(!r.ok)throw new Error(r.status===503?'Awaiting POE data':'Dashboard data unavailable.');const {snapshot:s,receivedAt,freshness:f}=await r.json();byId('content').hidden=false;byId('identity').textContent=s.account.id+' · inception '+s.account.inceptionAt+' · snapshot '+s.sequence+' · '+s.source.release+' / '+s.source.strategy;byId('state').textContent=f.state.toUpperCase()+' · '+s.status.market+' · entries '+s.status.entries+' · '+s.status.runtime+(s.status.blocker?'\nCurrent blocker: '+s.status.blocker:'');const b=s.balances;byId('cards').replaceChildren();[['Inception reference',money(s.account.initialUsd)],['Equity',money(b.equityUsd)],['Cash / reserved SOL',s.balances.cashSol+' / '+s.balances.reservedSol],['Total trading P&L',money(b.tradingPnlUsd)],['Realized trading P&L',money(b.realizedUsd)],['Unrealized trading P&L',money(b.unrealizedUsd)],['Economic P&L after operating costs',money(b.economicPnlUsd)],['Modeled execution costs',money(b.executionCostsUsd)],['Operating costs · '+s.costLabels.operating,money(b.operatingCostsUsd)],['Cost / marked exposure',money(b.positionCostUsd)+' / '+money(b.markedExposureUsd)],['Drawdown',money(b.drawdownUsd)],['Passive SOL benchmark equity',money(b.passiveSolEquityUsd)]].forEach(v=>card(v[0],v[1]));byId('freshness').textContent='Generated '+s.times.generatedAt+' · market '+(s.times.marketAt||'unavailable')+' · reconciled '+(s.times.reconciledAt||'unavailable')+' · receiver '+receivedAt+' · last useful progress '+(s.times.usefulProgressAt||'unavailable');chart(s.pnl);byId('chartNote').textContent=s.history.label+' · '+s.pnl.length+'/720 points · '+(s.history.downsampled?'downsampled':'as recorded')+' · window starts '+(s.history.windowStartAt||'unavailable');table('positions',['Token / quantity','Entry / net liquidation','Execution costs','Status'],s.positions.map(p=>[p.label+' · '+p.mint+' / '+p.quantity,money(p.entryCostUsd)+' / '+money(p.netLiquidationUsd),money(p.executionCostsUsd),p.status]));table('trades',['UTC / side','Token / quantity','Value / costs','Status / reason'],s.trades.map(t=>[t.at+' / '+t.side,t.mint+' / '+t.quantity,money(t.valueUsd)+' / '+money(t.executionCostsUsd),t.status+' · '+t.reason]));table('decisions',['UTC','Token','Stage','Reason'],s.decisions.map(d=>[d.at,d.mint,d.stage,d.reason]));byId('funnel').textContent=Object.entries(s.funnel).map(([k,v])=>k+': '+v).join('\n');byId('metrics').textContent=Object.entries(s.metrics).map(([k,v])=>k+': '+(v===null?'unavailable':v)).join('\n')}catch(e){byId('state').textContent=e.message+' Source freshness cannot be established.';byId('content').hidden=true}}
refresh();setInterval(refresh,30000);
</script></body></html>`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`required configuration missing: ${name}`); return value; };
  const port = Number(process.env.PORT ?? 10000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('invalid PORT');
  const { server } = createDashboard({
    accountId: process.env.POE_ACCOUNT_ID, inceptionAt: process.env.POE_INCEPTION_AT,
    release: process.env.POE_RUNTIME_RELEASE, strategy: process.env.POE_STRATEGY_VERSION,
    viewerUser: process.env.POE_VIEWER_USER ?? '', viewerPassword: process.env.POE_VIEWER_PASSWORD ?? '',
    publicViewer: process.env.POE_PUBLIC_VIEWER === 'true', ingestionSecret: required('POE_INGEST_SECRET'),
  });
  server.listen(port, '0.0.0.0', () => process.stdout.write(`poe-dashboard listening on ${port}; awaiting authenticated source\n`));
}
