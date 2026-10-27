import type { SnapshotCache } from './reporting.js';

/** Reporting projections only. Never reads a ledger, provider credential, or pilot workspace. */
export function connectionReport(cache: SnapshotCache, now = Date.now(), pilot?: {state:string; snapshot:unknown; lastContactAt?:number|null; sourceAgeMs?:number|null; publisherConnected?:boolean}) {
  const current = cache.read();
  const snapshot = current?.snapshot;
  const freshness = cache.status(now);
  const observerOnly = snapshot?.source.strategy === 'UNIMPLEMENTED_FLOW_BLOCKED';
  const receivedAgeMs = current ? Math.max(0, now - Date.parse(current.receivedAt)) : null;
  const sourceAgeMs = snapshot ? Math.max(0, now - Date.parse(snapshot.times.generatedAt)) : null;
  const source = snapshot ? {
    accountId: snapshot.account.id, inceptionAt: snapshot.account.inceptionAt,
    release: snapshot.source.release, strategy: snapshot.source.strategy,
    sequence: snapshot.sequence, generatedAt: snapshot.times.generatedAt,
    receivedAt: current!.receivedAt, entries: snapshot.status.entries,
    runtime: snapshot.status.runtime, market: snapshot.status.market,
    blocker: snapshot.status.blocker,
  } : null;
  return {
    schemaVersion: 1,
    checkedAt: new Date(now).toISOString(),
    dashboardRelease: process.env.RENDER_GIT_COMMIT ?? 'local-build',
    sourceConfigured: cache.identity !== null,
    connection: !current ? 'awaiting-source' : Math.max(sourceAgeMs!, receivedAgeMs!) > 90_000 ? 'stale' : 'receiving',
    sourceAgeMs, receivedAgeMs, source,
    sourceRole: !snapshot ? 'unknown' : observerOnly ? 'discovery-observer' : 'runtime-reported',
    capabilities: {
      discovery: !snapshot ? 'unavailable' : snapshot.status.market === 'observing' ? 'reported' : 'unavailable',
      candidatePipeline: !snapshot ? 'unavailable' : observerOnly ? 'not-implemented-in-source' : 'runtime-reported',
      decisionTrace: !snapshot ? 'unavailable' : observerOnly ? 'not-implemented-in-source' : 'runtime-reported',
      selectedTokenRpc: !snapshot ? 'unavailable' : observerOnly ? 'not-implemented-in-source' : 'runtime-reported',
      experimentalPilot: pilot?.snapshot?'separate-diagnostics-channel':pilot?.state==='awaiting-data'?'awaiting-separate-report':'not-connected',
    },
    experimentalPilot: {
      connected:pilot?.publisherConnected===true,
      state:pilot?.state??'not-configured',
      lastContactAt:pilot?.lastContactAt??null,sourceAgeMs:pilot?.sourceAgeMs??null,
      reason:'Original portfolio and experimental pilot diagnostics use separate authenticated channels. Pilot balances and performance are never merged into this account.',
    },
    freshness,
  };
}

const PANEL = `<section class="panel connection-panel" id="reportingConnections" aria-labelledby="connectionsTitle">
<div class="panel-heading"><div><div class="section-index">REPORTING CONNECTIONS</div><h2 id="connectionsTitle">Source &amp; pipeline status</h2></div><div class="panel-tag" id="connectionBadge">CHECKING SOURCE</div></div>
<p class="connection-explanation" id="sourceExplanation">Checking which runtime is publishing this dashboard. Data availability is separate from trading readiness.</p>
<div class="connection-grid"><div class="metric"><div class="metric-name">Authenticated source</div><div class="metric-value" id="sourceConnection">Awaiting snapshot</div></div><div class="metric"><div class="metric-name">Candidate evaluation</div><div class="metric-value" id="pipelineConnection">Unknown</div></div><div class="metric"><div class="metric-name">Experimental PAPER pilot</div><div class="metric-value" id="pilotConnection">Not connected to this dashboard</div></div><div class="metric"><div class="metric-name">Snapshot / age</div><div class="metric-value" id="snapshotConnection">Not received</div></div></div>
<div class="connection-controls"><span id="refreshStatus">Automatic refresh every 15 seconds</span><button type="button" id="refreshNow">Refresh now</button><a href="/api/connections" target="_blank" rel="noopener">Connection details</a></div>
<p class="connection-note" id="sourceIdentity"></p>
</section>`;

const STYLE = `
.connection-panel{margin:18px 0}.connection-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.connection-explanation{color:#b5c9de;line-height:1.7;margin:0 0 18px}.connection-controls{display:flex;align-items:center;flex-wrap:wrap;gap:16px;margin-top:18px;font:11px var(--mono);color:#8ca0ba}.connection-controls button{border:1px solid #376c7b;border-radius:7px;background:#102b38;color:#7ef5eb;padding:9px 13px;cursor:pointer}.connection-controls button:focus-visible,.connection-controls a:focus-visible{outline:2px solid #7ef5eb;outline-offset:4px}.connection-controls a{color:#9ccfef;text-decoration:underline}.connection-note,.source-panel-note{color:#9bb0c8;font:11px/1.65 var(--mono);overflow-wrap:anywhere}.source-panel-note{padding:12px;border:1px solid rgba(255,189,112,.2);border-radius:8px;background:rgba(255,189,112,.035);margin-bottom:14px}.inactive-stage .funnel-name{color:#8395ac}.inactive-stage .funnel-count{font-size:9px;color:#ffcf90;width:92px;white-space:normal;line-height:1.3}.inactive-stage{grid-template-columns:minmax(80px,1fr) minmax(30px,1fr) 92px}.connection-warning{color:#ffd196}.connection-note{margin-bottom:0}.metric-value{overflow-wrap:anywhere}@media(max-width:420px){.connection-grid{grid-template-columns:1fr}.connection-controls{gap:12px}.inactive-stage{grid-template-columns:minmax(100px,1fr) 32px 90px}}
`;

export const CONNECTION_SCRIPT = String.raw`
(function(){
'use strict';
let lastReport=null,lastReportAt=0,sourceProblem=null;
const set=(id,value)=>{const e=document.getElementById(id);if(e)e.textContent=String(value)};
const el=(parent,tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;parent.append(n);return n};
const age=(ms)=>ms===null||!Number.isFinite(ms)?'Unknown':Math.floor(ms/1000)+'s';
const observer=(s)=>s&&s.source.strategy==='UNIMPLEMENTED_FLOW_BLOCKED';
const note=(id,parent,text)=>{let n=document.getElementById(id);if(!n){n=document.createElement('div');n.id=id;n.className='source-panel-note';parent.prepend(n)}n.textContent=text;n.hidden=!text};
function paintConnection(){
 if(!lastReport)return;
 const elapsed=Math.max(0,performance.now()-lastReportAt);
 const d=lastReport,source=d.source;
 const sourceAge=d.sourceAgeMs===null?null:d.sourceAgeMs+elapsed;
 const stale=sourceAge!==null&&sourceAge>90000;
 const isObserver=d.sourceRole==='discovery-observer';
 set('connectionBadge',sourceProblem?'READ FAILED':!source?'AWAITING SOURCE':stale?'STALE SNAPSHOT':isObserver?'OBSERVER ONLY':'SOURCE REPORTING');
 set('sourceConnection',sourceProblem?'Browser read failed; last snapshot retained':!source?'No accepted snapshot':stale?'No fresh snapshot — last report retained':'Authenticated snapshot received');
 set('pipelineConnection',!source?'No source evidence':isObserver?'Not implemented in published runtime':source.entries==='enabled'?'Runtime reports entries enabled':'Entries '+source.entries+'; see reported counters');
 const pilot=d.experimentalPilot;set('pilotConnection',!pilot||pilot.state==='not-configured'?'Separate diagnostics not configured':pilot.connected?'Separate diagnostics connected · '+pilot.state:'Separate diagnostics '+pilot.state+' · publisher disconnected');
 set('snapshotConnection',source?'#'+source.sequence+' · source '+age(sourceAge)+' old':'Not received');
 set('sourceExplanation',isObserver?'This dashboard is receiving the EC2 discovery observer, not the experimental PAPER pilot. Discovery can advance while evaluation, execution and decisions remain inactive. Inactive stages below are not measured zero-result evaluations.':!source?'Waiting for an authenticated account snapshot. No balances, counters, or activity will be invented.':'Panels show only the configured source account. The experimental pilot is a separate account and is not combined with these metrics.');
 if(source)set('sourceIdentity','Account '+source.accountId+' · runtime '+source.release+' · strategy '+source.strategy+' · dashboard '+d.dashboardRelease);
 set('refreshStatus',(sourceProblem?'Last refresh failed; retrying. ':'')+'Auto-refresh 15s · last source read '+age(elapsed)+' ago');
 const badge=document.getElementById('connectionBadge');if(badge)badge.classList.toggle('connection-warning',!!sourceProblem||stale||isObserver);
 if(stale&&!sourceProblem&&source){document.body.dataset.link='warning';set('stateTitle','Stale source snapshot');set('sourceLabel','CHECK SOURCE FRESHNESS');}
}
const originalFunnel=renderFunnel;
renderFunnel=function(f){
 originalFunnel(f);
 const p=document.getElementById('funnel'),isObserver=observer(latest);
 note('funnelCapability',p,isObserver?'Only migration discovery is connected in this runtime. Later zero-valued fields are placeholders; they do not mean tokens were evaluated and rejected.':'');
 if(isObserver)Array.from(p.querySelectorAll('.funnel-line')).slice(1).forEach(row=>{row.classList.add('inactive-stage');const n=row.querySelector('.funnel-count');if(n)n.textContent='NOT ACTIVE';const bar=row.querySelector('.funnel-fill');if(bar)bar.style.width='0%'});
};
renderMetrics=function(m,source){
 const p=document.getElementById('metrics');p.replaceChildren();const grid=el(p,'div',undefined,'metric-grid'),isObserver=source.strategy==='UNIMPLEMENTED_FLOW_BLOCKED';
 const numeric=(v,decimals=0)=>v===null||v===undefined?'Not reported':Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:decimals}):String(v);
 const entries=[
 ['Market coverage',m.coverage],['Latency evidence',m.latency],
 ['Processing lag',m.processingLagMs===null?'Not instrumented by source':numeric(m.processingLagMs,2)+' ms'],
 ['Event-loop lag',m.eventLoopLagMs===null?'Not reported':numeric(m.eventLoopLagMs,2)+' ms'],
 ['Provider events (source session)',numeric(m.providerEvents)],
 ['Selected-token RPC',isObserver?'Not connected in observer':numeric(m.rpcRequests)],
 ['Projected data SOL/day',m.projectedDailyDataSol===null?'Not reported':numeric(m.projectedDailyDataSol,6)+(isObserver?' — migration observer only':'')],
 ['Data-wallet budget',m.budgetRemainingSol===null?'Not configured / not reported':numeric(m.budgetRemainingSol,6)+' SOL'],
 ['Budget status',m.budgetStatus==='unavailable'?'No budget telemetry':m.budgetStatus],
 ['Runtime release',source.release],['Strategy version',source.strategy]
 ];
 entries.forEach(([label,value])=>{const cell=el(grid,'div',undefined,'metric');el(cell,'div',label,'metric-name');el(cell,'div',value,'metric-value')});
};
const originalShow=showSnapshot;
showSnapshot=function(s,received,f,connections){
 sourceProblem=null;lastReport=connections||null;lastReportAt=performance.now();
 originalShow(s,received,f);
 if(observer(s)){
  set('decisionsCount','NOT CONNECTED');
  renderTable('decisions',['UTC','Mint','Stage','Reason'],s.decisions,'EVALUATION ENGINE NOT CONNECTED','This EC2 source publishes discovery only. Pilot decisions remain in the isolated pilot workspace, not this account.');
  if(f.state!=='stale'&&f.state!=='unavailable'){set('stateTitle','Discovery observer reporting');set('sourceLabel','REPORTING LIVE · TRADING INACTIVE');set('state','The authenticated EC2 observer feed is connected. Candidate evaluation and execution are not implemented in this source release. Experimental pilot reporting is separate.');}
 }
 paintConnection();
};
const originalSignal=signal;
signal=function(title,message,label,mode,time){originalSignal(title,message,label,mode,time);if(mode==='error'){sourceProblem=label;paintConnection()}};
document.getElementById('refreshNow').addEventListener('click',()=>{void refresh()});
window.addEventListener('focus',()=>{void refresh()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){paintConnection();void refresh()}});
setInterval(paintConnection,1000);
fetch('/api/connections',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)throw Error('connection diagnostics unavailable');return r.json()}).then(d=>{if(!lastReport){lastReport=d;lastReportAt=performance.now();paintConnection()}}).catch(()=>{});
})();
`;

export function withConnectionDiagnostics(html: string): string {
  if (!html.includes('<main>') || !html.includes('</style>') || !html.includes('</body>')) throw new Error('dashboard template anchors missing');
  return html.replace('</style>', STYLE + '</style>').replace('<main>', '<main>' + PANEL).replace('</body>', '<script>' + CONNECTION_SCRIPT + '</script></body>');
}
