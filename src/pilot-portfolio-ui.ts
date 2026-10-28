/** Separate experimental portfolio. All values are calculated by its source
 * ledger projection; this viewer never calculates fills or financial P&L. */
export const PILOT_PORTFOLIO_HTML=String.raw`
<style>#experimental-portfolio p,#experimental-portfolio .metric-value{overflow-wrap:anywhere}#experimental-portfolio .metric{min-width:0}#experimental-portfolio h3{font-size:13px;margin:22px 0 9px}#experimental-portfolio-state{white-space:normal;line-height:1.5}#experimental-portfolio-source{white-space:pre-line}#experimental-portfolio .identity-line p{padding:9px 0;border-bottom:1px solid rgba(116,157,203,.1)}@media(max-width:360px){#experimental-portfolio .metric-grid{grid-template-columns:1fr}}</style>
<section class="panel full-panel" id="experimental-portfolio" aria-labelledby="experimental-portfolio-title">
<div class="panel-heading"><div><div class="section-index">EXPERIMENTAL PAPER · OWN ACCOUNT</div><h2 id="experimental-portfolio-title">Experimental portfolio</h2></div><div class="panel-tag" id="experimental-portfolio-state">AWAITING PAPER SOURCE</div></div>
<p class="pilot-note" id="experimental-portfolio-source">No current experimental financial projection has been received. The original portfolio above is unchanged.</p>
<div class="metric-grid" id="experimental-portfolio-cards"></div>
<h3>Experimental positions</h3><div class="identity-line" id="experimental-portfolio-positions">Unavailable.</div>
<h3>Experimental trades and attempts</h3><div class="identity-line" id="experimental-portfolio-trades">Unavailable.</div>
<h3>Experimental trading P&amp;L · USD</h3>
<div class="chart-shell"><svg id="experimental-portfolio-chart" viewBox="0 0 900 240" role="img" aria-label="Separate experimental PAPER trading profit and loss, with missing source values shown as gaps"></svg></div>
<p class="pilot-note" id="experimental-portfolio-history">No historical performance is assumed.</p>
</section>`;

export const PILOT_PORTFOLIO_SCRIPT=String.raw`<script>
(function(){
'use strict';
const node=id=>document.getElementById(id);
const create=(tag,value,cls)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=String(value);if(cls)e.className=cls;return e;};
const utc=x=>typeof x==='string'?x:Number.isSafeInteger(x)?new Date(x).toISOString():'Unavailable';
const currency=x=>typeof x==='number'&&Number.isFinite(x)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(x):'Unavailable';
const sol=value=>{if(typeof value!=='string'||! /^-?(0|[1-9][0-9]*)$/.test(value))return 'Unavailable';const negative=value.startsWith('-'),digits=negative?value.slice(1):value,whole=digits.length>9?digits.slice(0,-9):'0',fraction=(digits.length>9?digits.slice(-9):digits.padStart(9,'0')).replace(/0+$/,'');return (negative?'-':'')+whole+(fraction?'.'+fraction:'')+' SOL';};
const svg=(tag,attrs,value)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(value!==undefined)e.textContent=String(value);return e;};
let source=null;
function graph(points){
 const root=node('experimental-portfolio-chart');root.replaceChildren();
 const actual=Array.isArray(points)?points:[],valid=actual.filter(p=>typeof p.tradingUsd==='number'&&Number.isFinite(p.tradingUsd)&&Number.isFinite(Date.parse(p.at)));
 if(!valid.length){root.append(svg('text',{x:450,y:120,fill:'#8ca0ba','text-anchor':'middle'},'No verified experimental P&L history'));return;}
 const times=actual.map(p=>Date.parse(p.at)).filter(Number.isFinite),start=Math.min(...times),end=Math.max(...times),low=Math.min(0,...valid.map(p=>p.tradingUsd)),high=Math.max(0,...valid.map(p=>p.tradingUsd)),span=high-low||1;
 const x=t=>40+(Date.parse(t)-start)/Math.max(1,end-start)*820,y=v=>200-(v-low)/span*165;
 root.append(svg('line',{x1:40,x2:860,y1:y(0),y2:y(0),stroke:'#6684a3','stroke-dasharray':'5 5'}));
 let segment=[];const flush=()=>{if(segment.length)root.append(svg('polyline',{points:segment.join(' '),fill:'none',stroke:'#b78cff','stroke-width':2}));segment=[];};
 for(const p of actual){if(typeof p.tradingUsd!=='number'||!Number.isFinite(p.tradingUsd)||!Number.isFinite(Date.parse(p.at))){flush();continue;}segment.push(x(p.at)+','+y(p.tradingUsd));root.append(svg('circle',{cx:x(p.at),cy:y(p.tradingUsd),r:2,fill:'#b78cff'}));}flush();
 root.append(svg('text',{x:40,y:229,fill:'#8ca0ba','font-size':10},new Date(start).toISOString()+' UTC'));
 root.append(svg('text',{x:860,y:229,fill:'#8ca0ba','font-size':10,'text-anchor':'end'},new Date(end).toISOString()+' UTC'));
}
function status(){
 if(!source||!source.portfolio)return;
 const p=source.portfolio,age=Math.max(0,Date.now()-Date.parse(p.times.generatedAt)),stale=age>90000;
 node('experimental-portfolio-state').textContent=[source.running?'PAPER SOURCE RUNNING':'STOPPED',stale?'FINANCIAL SOURCE STALE':p.status.reconciled?'RECONCILED AS REPORTED':'RECONCILIATION UNAVAILABLE',p.status.entries==='enabled'?'ENTRIES ENABLED':'ENTRIES '+p.status.entries.toUpperCase()].join(' · ');
 node('experimental-portfolio-state').classList.toggle('pilot-warning',stale||!source.running||!p.status.reconciled);
 node('experimental-portfolio-source').textContent='Experimental account '+p.account.id+' · inception '+p.account.inceptionAt+' · sequence '+p.sequence+'\nRuntime '+p.source.release+' · strategy '+p.source.strategy+'\nFinancial source '+p.times.generatedAt+' · market '+(p.times.marketAt||'Unavailable')+' · reconciliation '+(p.times.reconciledAt||'Unavailable')+' · SOL accounting source '+(source.accounting?utc(source.accounting.at):'Unavailable')+'. Original EC2 portfolio remains separate. '+(!source.running?'This source is stopped; continuing position protection is not implied.':stale?'These are retained values, not current financial or protection facts.':'Source reports only; PAPER outcomes are simulated.');
}
window.renderExperimentalPortfolio=function(report){
 source=report&&report.mode==='paper'&&report.financialExecutionAuthorized===true&&report.portfolio?report:null;
 if(!source){node('experimental-portfolio-state').textContent=report&&report.mode==='candidate-evaluation'?'CANDIDATE EVALUATION · NO FINANCIAL EXECUTION':'AWAITING PAPER SOURCE';node('experimental-portfolio-source').textContent='No current experimental financial projection is reported. Candidate diagnostics and historical balances are not presented as current portfolio performance. The original account remains unchanged.';node('experimental-portfolio-cards').replaceChildren();node('experimental-portfolio-positions').replaceChildren(create('p','No experimental position projection reported.'));node('experimental-portfolio-trades').replaceChildren(create('p','No experimental trade projection reported.'));node('experimental-portfolio-history').textContent='No historical performance is assumed.';graph([]);return;}
 const p=source.portfolio,b=p.balances,a=source.accounting;
 const entries=[['Virtual inception',currency(p.account.initialUsd)],['Equity',currency(b.equityUsd)],['Cash / reserved SOL',b.cashSol+' / '+b.reservedSol],['Total trading P&L · SOL',sol(a?.totalPnlLamports)],['Realized P&L · SOL',sol(a?.realizedLamports)],['Unrealized P&L · SOL',sol(a?.unrealizedLamports)],['Modeled execution costs · SOL',sol(a?.executionCostsLamports)],['Locked refundable deposits · SOL',sol(a?.lockedDepositLamports)],['Total trading P&L · USD',currency(b.tradingPnlUsd)],['Realized P&L',currency(b.realizedUsd)],['Unrealized P&L',currency(b.unrealizedUsd)],['Economic P&L',currency(b.economicPnlUsd)],['Position cost / net exposure',currency(b.positionCostUsd)+' / '+currency(b.markedExposureUsd)],['Modeled execution costs',currency(b.executionCostsUsd)],['Operating costs',currency(b.operatingCostsUsd)+' · '+p.costLabels.operating],['Drawdown',currency(b.drawdownUsd)],['Passive SOL benchmark',currency(b.passiveSolEquityUsd)]];
 const cards=node('experimental-portfolio-cards');cards.replaceChildren();entries.forEach(([label,value])=>{const e=create('div',undefined,'metric');e.append(create('div',label,'metric-name'),create('div',value,'metric-value'));cards.append(e);});
 const positions=node('experimental-portfolio-positions');positions.replaceChildren();if(!p.positions.length)positions.append(create('p','No open positions in this source snapshot.'));else p.positions.forEach(v=>positions.append(create('p',v.mint+' · units '+v.quantity+' · entry '+v.enteredAt+' · entry cost '+currency(v.entryCostUsd)+' · net liquidation '+currency(v.netLiquidationUsd)+' · '+v.status)));
 const trades=node('experimental-portfolio-trades');trades.replaceChildren();if(!p.trades.length)trades.append(create('p','No simulated trades or attempts in the bounded source window.'));else p.trades.slice(-30).reverse().forEach(v=>trades.append(create('p',v.at+' · '+v.mint+' · '+v.side+' · units '+v.quantity+' · '+v.status+' · '+currency(v.valueUsd)+' · modeled cost '+currency(v.executionCostsUsd)+' · '+v.reason)));
 graph(p.pnl);node('experimental-portfolio-history').textContent=p.history.label+' · '+p.pnl.length+'/720 actual source points · '+(p.history.downsampled?'downsampled':'as recorded')+' · UTC. Null values remain gaps; a zero reference is not fabricated historical performance. After-operating-cost performance is separately reported above.';status();
};
setInterval(status,1000);window.renderExperimentalPortfolio(null);
})();
</script>`;
