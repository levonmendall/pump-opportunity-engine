/** Separate experimental diagnostics. May drive candidate/decision panels only; never alters authoritative financial portfolio data. */
export const CONNECTIONS_HTML=String.raw`
<style>
#pilot-telemetry-panel{margin:18px 0}#pilot-telemetry-panel .panel-heading{gap:12px;flex-wrap:wrap}#pilot-link-state{white-space:normal;max-width:100%;line-height:1.5}#pilot-telemetry-panel p,#pilot-telemetry-panel .metric-value{overflow-wrap:anywhere}#pilot-telemetry-panel .metric{min-width:0}#pilot-telemetry-panel .metric-name{white-space:normal;line-height:1.45}#pilot-telemetry-panel .metric-value{font-size:15px}#pilot-telemetry-panel h3{font-size:13px;margin:22px 0 9px}#pilot-telemetry-panel .pilot-note{color:#a8bdd4;font-size:12px;line-height:1.7}#pilot-source-detail{white-space:pre-line;font:10px/1.8 var(--mono);color:#8ca0ba}#pilot-decisions p,#pilot-refusals p{font:10px/1.7 var(--mono);padding:9px 0;margin:0;border-bottom:1px solid rgba(116,157,203,.1)}#pilot-telemetry-panel .pilot-grids{margin-top:14px}#pilot-telemetry-panel .pilot-warning{color:#ffd196}@media(max-width:360px){#pilot-telemetry-panel .metric-grid{grid-template-columns:1fr}}
</style>
<section class="panel full-panel" id="pilot-telemetry-panel" aria-labelledby="pilot-telemetry-title">
<div class="panel-heading"><div><div class="section-index">EXPERIMENTAL PAPER · SEPARATE SOURCE</div><h2 id="pilot-telemetry-title">Pilot diagnostics</h2></div><div class="panel-tag" id="pilot-link-state" role="status" aria-live="polite">CHECKING CHANNEL</div></div>
<p class="pilot-note">These are isolated experimental diagnostics. The original EC2 portfolio above retains its own account and financial history. No pilot balances or results are merged into it.</p>
<p id="pilot-link-detail" class="identity-line">Checking the separate reporting channel…</p>
<p id="pilot-source-detail"></p>
<div id="pilot-funnel" class="metric-grid"></div>
<h3>Market watch and deep analysis</h3><div id="pilot-watch" class="metric-grid"></div>
<p class="pilot-note">Watch identities are lightweight market awareness, separate from deep observation and held positions. The ready queue excludes cooldown and backoff; deferred identities remain in the watch total. Registry promotion and complete-window totals persist across research runs; feature-only, primary strategy rejection, incomplete-data and enrichment-deadline counts describe the current run. Feature-only assessments inform slot allocation; they do not qualify an entry or grant risk permission. Queue and completed-admission waits measure elapsed wall time, including stopped intervals—not provider latency or delay caused solely by capacity. Counts describe received and verified evidence, not the entire market. No market-coverage percentage is inferred.</p>
<div id="pilot-metrics" class="metric-grid pilot-grids"></div>
<p class="pilot-note">Funnel, swap and accounting counters describe the identified pilot run. Validated swap events are market observations; PAPER fills and exits are simulated portfolio actions. Accounting reconciliations include zero-trade checks. Source age describes the local status file, not complete market coverage or continuous position protection.</p>
<h3>Recent pilot decisions</h3><div id="pilot-decisions" class="identity-line">No pilot report received.</div>
<h3>Pilot refusals</h3><div id="pilot-refusals" class="identity-line">No pilot report received.</div>
</section>`;

export const CONNECTIONS_SCRIPT=String.raw`<script>
(function(){
'use strict';
const id=k=>document.getElementById(k);
const el=(tag,txt,cls)=>{const n=document.createElement(tag);if(txt!==undefined)n.textContent=String(txt);if(cls)n.className=cls;return n;};
const pretty=n=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n):'Not reported';
const time=n=>Number.isSafeInteger(n)&&n>0?new Date(n).toISOString():'unavailable';
const age=n=>typeof n==='number'&&Number.isFinite(n)?pretty(Math.max(0,n)/1000)+'s':'unavailable';
const sourceStaleMs=90000;
let pilot=null,readAtMono=0,inFlight=false,transportOk=false,timer;
function ages(){
 if(!pilot||!pilot.snapshot)return {source:null,publisher:null};
 const elapsed=Math.max(0,performance.now()-readAtMono);
 const source=typeof pilot.sourceAgeMs==='number'?pilot.sourceAgeMs+elapsed:Math.max(0,Date.now()-pilot.snapshot.generatedAt);
 const contact=pilot.lastContactAt??pilot.receivedAt;
 const publisher=typeof pilot.lastContactAgeMs==='number'?pilot.lastContactAgeMs+elapsed:typeof pilot.receiverAgeMs==='number'?pilot.receiverAgeMs+elapsed:Number.isFinite(contact)?Math.max(0,Date.now()-contact):null;
 return {source,publisher};
}
function ageTick(){
 if(!pilot||!pilot.snapshot)return;
 const s=pilot.snapshot,a=ages(),sourceStale=a.source===null||a.source>sourceStaleMs,publisherStale=a.publisher===null||a.publisher>sourceStaleMs;
 const state=[];
 if(!transportOk)state.push('DASHBOARD READ FAILED');
 if(publisherStale)state.push('PUBLISHER DISCONNECTED');
 state.push(s.running===false?'STOPPED':'RUNNING REPORTED');
 if(sourceStale)state.push('SOURCE STALE');
 id('pilot-link-state').textContent=state.join(' · ');
 id('pilot-link-state').classList.toggle('pilot-warning',!transportOk||sourceStale||publisherStale||s.running===false);
 const risk=s.running===false?'Pilot is stopped; no ongoing monitoring is implied.':s.mode==='candidate-evaluation'?'Frozen candidate evaluation; financial execution is intentionally disabled.':s.entriesEnabled?'Source reports experimental PAPER entries enabled.':'Source reports experimental PAPER entries disabled.';
 id('pilot-link-detail').textContent=risk+' '+s.status+(!transportOk?' Last report is retained after the failed dashboard read.':'');
 id('pilot-source-detail').textContent='Account '+s.accountId+' · inception '+time(s.inceptionAt)+'\nRun '+s.runId+'\nRuntime '+s.source.release+' · strategy '+s.source.strategy+' · mode '+(s.mode||'legacy diagnostics')+'\nLocal source '+time(s.generatedAt)+' ('+age(a.source)+' old) · first accepted '+time(pilot.receivedAt)+'\nLast authenticated publisher contact '+time(pilot.lastContactAt??pilot.receivedAt)+' ('+age(a.publisher)+' ago). Receiver contact does not refresh source facts.';
}
function grid(target,entries){const root=id(target);root.replaceChildren();entries.forEach(([label,value])=>{const m=el('div',undefined,'metric');m.append(el('div',label,'metric-name'),el('div',typeof value==='string'?value:pretty(value),'metric-value'));root.append(m);});}
function clearData(message){if(typeof renderExperimentalPortfolio==='function')renderExperimentalPortfolio(null);id('pilot-funnel').replaceChildren();id('pilot-watch').replaceChildren();id('pilot-metrics').replaceChildren();id('pilot-source-detail').textContent='';id('pilot-decisions').replaceChildren(el('p',message));id('pilot-refusals').replaceChildren(el('p',message));}
function showPilot(p){
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('invalid diagnostic response');
 if(p.snapshot){const s=p.snapshot;if(s.kind!=='experimental-pilot'||s.authoritative!==false||s.liveTrading!==false||typeof s.running!=='boolean'||!s.source||typeof s.source.release!=='string'||typeof s.source.strategy!=='string'||!s.funnel||!s.metrics||!Number.isSafeInteger(s.generatedAt)||!Number.isSafeInteger(s.inceptionAt)||typeof s.accountId!=='string'||!/^poe-pilot-[a-z0-9-]+$/.test(s.accountId))throw Error('invalid diagnostic identity');}
 pilot=p;readAtMono=performance.now();transportOk=true;
 if(!p.snapshot){const configured=p.state!=='not-configured';id('pilot-link-state').textContent=configured?'AWAITING DATA':'NOT CONFIGURED';id('pilot-link-state').classList.add('pilot-warning');id('pilot-link-detail').textContent=(typeof p.message==='string'?p.message:'No experimental pilot report is available.')+' The original account is a separate source.';clearData('No pilot report received.');if(typeof clearPilotIntelligence==='function')clearPilotIntelligence();return;}
 const s=p.snapshot;
 if(typeof renderExperimentalPortfolio==='function')renderExperimentalPortfolio(s);
 if(typeof setPilotIntelligence==='function')setPilotIntelligence(s,p.state,p.sourceAgeMs,p.publisherConnected);
 const labels={discovered:'Migration hints (run)',supported:'Supported candidates',verifiedMigrationOrigins:'Verified migration origins',admitted:'Candidates admitted',sufficientlyObserved:'Sufficiently observed',usableWindows:'Usable windows',evaluated:'Evaluations',qualified:'Qualified decisions',reserved:'Orders reserved',attempted:'PAPER attempts',paperFilled:'PAPER entries filled',exited:'PAPER exits filled',reconciled:'Accounting reconciliations'};
 grid('pilot-funnel',Object.entries(labels).map(([k,label])=>[label,s.funnel[k]]));
 const w=s.watch;
 if(w){grid('pilot-watch',[
  ['Recent identities known',w.known],['Eligible verified identities',w.eligibleKnown],['Watch candidates',w.watch],
  ['Deep slots active / maximum',pretty(w.deepActive)+' / '+pretty(w.maximumDeep)],['Ready deep-analysis queue',w.queued],
  ['Current queue wait: average / maximum (s)',pretty(typeof w.waitMs?.mean==='number'?w.waitMs.mean/1000:null)+' / '+pretty(typeof w.waitMs?.maximum==='number'?w.waitMs.maximum/1000:null)],
  ['Completed admission wait: average / maximum (s)',pretty(typeof w.promotionWaitMs?.mean==='number'?w.promotionWaitMs.mean/1000:null)+' / '+pretty(typeof w.promotionWaitMs?.maximum==='number'?w.promotionWaitMs.maximum/1000:null)],
  ['Promotions / re-promotions',pretty(w.promoted)+' / '+pretty(w.repromoted)],['Demotions',w.demoted],['Complete 60-second windows',w.completeWindows],
  ['Feature-only assessments',w.predictiveAssessments],['Feature-only failures',w.predictiveFailures],['Primary strategy rejections',w.strategyRejections],
  ['Capacity exclusions',w.capacityExclusions],['Incomplete-data exclusions',w.incompleteDataExclusions],
  ['Enrichment deadline failures',w.enrichmentDeadlineFailures],['Structural exclusions',w.structuralExclusions],['Expired identities',w.expired]
 ]);}else id('pilot-watch').replaceChildren(el('p','Market-watch metrics are not reported by this source.'));
 const metrics={rpcRequests:'Read / control request units',providerEvents:'Broad feed frames received',normalizedTrades:'Validated swap events',eventLoopLagMs:'Event-loop p95 (ms)',maximumCompletedGapMs:'Max holding-evaluation gap (ms)',maximumQuoteAgeMs:'Max quote age at use (ms)',protectionBreaches:'Protection boundary breaches',unavailableChecks:'Unavailable checks',streamBytes:'Received stream bytes'};
 grid('pilot-metrics',Object.entries(metrics).map(([k,label])=>[label,s.metrics[k]]));
 const decisions=id('pilot-decisions');decisions.replaceChildren();const rows=Array.isArray(s.decisions)?s.decisions.slice(-15):[];if(!rows.length)decisions.append(el('p','No decisions reported by this pilot.'));else rows.reverse().forEach(x=>decisions.append(el('p',time(x.at)+' · '+x.mint+' · '+x.stage+' · '+x.reason)));
 const refusals=id('pilot-refusals');refusals.replaceChildren();const refusalsRows=Array.isArray(s.refusals)?s.refusals.slice(0,30):[];if(!refusalsRows.length)refusals.append(el('p','No refusals reported by this pilot.'));else refusalsRows.forEach(x=>refusals.append(el('p',x.reason+': '+pretty(x.count))));
 ageTick();
}
async function poll(){if(inFlight)return;clearTimeout(timer);inFlight=true;try{const r=await fetch('/api/pilot',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('pilot read unavailable');const raw=await r.text();if(raw.length>262144)throw Error('diagnostic response limit');showPilot(JSON.parse(raw));}catch{transportOk=false;if(pilot&&pilot.snapshot)ageTick();else{id('pilot-link-state').textContent='DASHBOARD READ FAILED';id('pilot-link-state').classList.add('pilot-warning');id('pilot-link-detail').textContent='Separate pilot diagnostics could not be fetched. No runtime state or counters are assumed.';}}finally{inFlight=false;timer=setTimeout(poll,15000);}}
poll();setInterval(ageTick,1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
})();
</script>`;
