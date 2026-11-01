/** Reporting-only AI status channel. No ledger, service-control, or model API access. */
import {createPublicKey, verify, createHash, timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {attachReviewedSourceHandover} from './reviewed-source-handover.mjs';
export const ACCOUNT='poe-3123e352-4581-455b-85db-acd7e825e99e';
const MAX=65536,TTL=15*60*1000;
const equal=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
const send=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body));};
function decode(text){if(typeof text!=='string'||text.length>MAX||!text.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw Error('encoding');const b=Buffer.from(text,'base64');if(b.toString('base64')!==text)throw Error('encoding');return b;}
export class AiStatusCache {
  constructor(publicKey,clock=Date.now){this.clock=clock;this.value=null;this.digest=null;this.at=0;this.key=null;if(publicKey){this.key=createPublicKey({key:decode(publicKey),format:'der',type:'spki'});if(this.key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 public key required');}}
  accept(envelope){
    if(!this.key)throw Error('not-configured');
    if(!envelope||Object.keys(envelope).sort().join(',')!=='payload,signature')throw Error('envelope');
    const raw=decode(envelope.payload),signature=decode(envelope.signature);
    if(raw.length>32768||signature.length!==64||!verify(null,raw,this.key,signature))throw Error('signature');
    const value=JSON.parse(raw.toString('utf8')),at=Date.parse(value.generatedAt),now=this.clock();
    if(value.schema!==1||value.accountId!==ACCOUNT||!['OBSERVATION_ONLY','MODEL_REVIEW','BLOCKED'].includes(value.mode)||!Number.isFinite(at)||at>now+10000||now-at>TTL)throw Error('identity-or-time');
    if(value.autonomousDeployment!==false)throw Error('unsupported-deployment-claim');
    if(value.mode!=='BLOCKED'&&(!/^[a-f0-9]{40}$/.test(value.installedRelease)||!value.workflows||typeof value.workflows!=='object'||Array.isArray(value.workflows)))throw Error('source');
    const digest=createHash('sha256').update(raw).digest('hex');
    if(at<this.at||(at===this.at&&this.digest!==digest))throw Error('regression-or-conflict');
    this.at=at;this.digest=digest;this.value=value;return {accepted:true,sha256:digest};
  }
  read(){const age=this.value?this.clock()-this.at:null;return {configured:!!this.key,state:!this.key?'unconfigured':!this.value?'awaiting-report':age>TTL?'stale':this.value.mode==='BLOCKED'?'blocked':'current',receivedContentSha256:this.digest,ageMs:age,report:this.value,meaning:'AI supervision status only; not proof of trading health, profitability, or autonomous repair.'};}
}
function body(req){return new Promise((resolve,reject)=>{let size=0,done=false;const parts=[];req.on('data',chunk=>{size+=chunk.length;if(size>MAX){done=true;parts.length=0;reject(Error('size'));}else if(!done)parts.push(chunk);});req.on('end',()=>{if(done)return;try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(Error('json'));}});req.on('error',reject);});}
export function inject(html){
  const panel='<div class="panel" id="ai-team-status" style="margin-top:16px"><h3>AI team supervision</h3><p id="ai-team-message">Awaiting independently signed AI-team status.</p><p class="muted">Separate from trading. Model review and automatic repair are not implied by an observer heartbeat.</p></div>';
  const marker=/<section\b[^>]*\bid="portfolio"[^>]*>[\s\S]*?<\/section>/;
  if(!marker.test(html))return html;
  html=html.replace(marker,s=>s.replace('</section>',panel+'</section>'));
  const script=`<script>(function(){async function updateAiTeam(){const el=document.getElementById('ai-team-message');if(!el)return;try{const r=await fetch('/api/ai-team',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('unavailable');const d=await r.json(),s=d.report;el.textContent=d.state+' | '+(s?s.mode+' | release '+(s.installedRelease||'unavailable').slice(0,8)+' | '+Object.entries(s.workflows||{}).map(([k,v])=>k+': '+v).join('; '):'No verified report received');}catch{el.textContent='AI team status unavailable — not evidence of healthy supervision.';}}updateAiTeam();setInterval(updateAiTeam,60000);})();</script>`;
  return html.replace('</body>',script+'</body>');
}
export function attachAiReporting(server,config){
  const cache=new AiStatusCache(config.publicKey);const original=server.listeners('request');
  if(original.length!==1)throw Error('expected one dashboard request handler');
  server.removeAllListeners('request');
  server.on('request',async(req,res)=>{
    const path=req.url?.split('?')[0];
    if(path==='/api/ai-team'){
      res.setHeader('x-content-type-options','nosniff');
      if(req.method==='POST'){
        if(!cache.key){req.resume();send(res,503,{error:'ai-reporting-not-configured'});return;}
        if(req.headers['content-type']?.split(';')[0]!=='application/json'||req.headers['content-encoding']){req.resume();send(res,415,{error:'plain-json-required'});return;}
        if(Number(req.headers['content-length']||0)>MAX){req.resume();send(res,413,{error:'size'});return;}
        try{send(res,200,cache.accept(await body(req)));}catch{send(res,400,{error:'invalid-signed-ai-report'});}return;
      }
      const expected='Basic '+Buffer.from(config.viewerUser+':'+config.viewerPassword).toString('base64');
      if(config.publicViewer!==true&&!equal(req.headers.authorization||'',expected)){req.resume();res.setHeader('www-authenticate','Basic realm="POE owner"');send(res,401,{error:'owner-authentication-required'});return;}
      if(req.method!=='GET'){req.resume();send(res,405,{error:'read-only-viewer'});return;}
      send(res,200,cache.read());return;
    }
    if(path==='/'&&req.method==='GET'){
      const end=res.end.bind(res);
      res.end=function(chunk,...args){if(res.statusCode===200&&typeof chunk==='string'&&String(res.getHeader('content-type')).startsWith('text/html'))chunk=inject(chunk);return end(chunk,...args);};
    }
    return original[0].call(server,req,res);
  });
  return cache;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const {createDashboard}=await import('../dist/src/dashboard.js');
  const {restoreRenderReceiverHistory}=await import('../dist/src/render-history-bootstrap.js');
  const inception='2026-10-26T22:07:36.212Z';
  if((process.env.POE_ACCOUNT_ID||process.env.POE_INCEPTION_AT)&&(process.env.POE_ACCOUNT_ID!==ACCOUNT||process.env.POE_INCEPTION_AT!==inception))throw Error('original POE identity required');
  const port=Number(process.env.PORT||10000);if(!Number.isSafeInteger(port)||port<1||port>65535)throw Error('invalid PORT');
  const config={accountId:process.env.POE_ACCOUNT_ID,inceptionAt:process.env.POE_INCEPTION_AT,release:process.env.POE_RUNTIME_RELEASE,strategy:process.env.POE_STRATEGY_VERSION,viewerUser:process.env.POE_VIEWER_USER||'',viewerPassword:process.env.POE_VIEWER_PASSWORD||'',publicViewer:process.env.POE_PUBLIC_VIEWER==='true',ingestionSecret:process.env.POE_INGEST_SECRET||''};
  const {server,cache}=createDashboard(config);attachReviewedSourceHandover(cache);attachAiReporting(server,{...config,publicKey:process.env.POE_AI_REPORT_PUBLIC_KEY});
  if(cache.identity)restoreRenderReceiverHistory(cache);
  server.listen(port,'0.0.0.0',()=>process.stdout.write('poe-dashboard with separate signed AI status channel listening\n'));
}
