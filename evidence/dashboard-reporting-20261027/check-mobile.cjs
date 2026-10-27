const { chromium } = require('/tmp/poe-browser-check/node_modules/playwright-core');
const fs = require('node:fs');
const url = 'https://meme-machine-dashboard-staging.onrender.com';
(async () => {
  const proxyValue = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const proxy = proxyValue ? (() => { const p = new URL(proxyValue); return { server: p.protocol + '//' + p.host, ...(p.username ? { username: decodeURIComponent(p.username), password: decodeURIComponent(p.password) } : {}) }; })() : undefined;
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, proxy, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = [], failed = [], responses = [];
    page.on('pageerror', e => errors.push(String(e.message).slice(0,500)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0,500)); });
    page.on('requestfailed', req => failed.push({url: req.url(), failure: req.failure()?.errorText}));
    page.on('response', r => responses.push({url: r.url(), status: r.status()}));
    const main = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 45000});
    await page.waitForFunction(() => { const s = document.getElementById('pilot-link-state')?.textContent; return !!s && s !== 'CHECKING CHANNEL'; }, {timeout: 20000});
    await page.waitForTimeout(1000);
    const pageState = await page.evaluate(() => {
      const text = id => document.getElementById(id)?.textContent?.trim() ?? null;
      const overflowing = Array.from(document.querySelectorAll('body *')).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed';
      }).slice(0,30).map(el => ({tag:el.tagName,id:el.id,classes:el.className,rect:{left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width}}));
      return {title:document.title, viewportWidth:innerWidth, documentWidth:document.documentElement.scrollWidth, bodyWidth:document.body.scrollWidth,
        pilotState:text('pilot-link-state'),pilotDetail:text('pilot-link-detail'),pilotSource:text('pilot-source-detail'),pilotFunnel:text('pilot-funnel'),pilotMetrics:text('pilot-metrics'),pilotDecisions:text('pilot-decisions'),originalSource:text('sourceIdentity'),originalStatus:text('stateTitle'), pilotPanelCount:document.querySelectorAll('#pilot-telemetry-panel').length, overflowing};
    });
    const api = await page.request.get(url + '/api/pilot', {timeout:10000});
    const p = await api.json();
    const original = await page.request.get(url + '/api/snapshot', {timeout:10000});
    const o = await original.json();
    const facts = {checkedAt:new Date().toISOString(),url,mainStatus:main.status(),browser:'Chromium',viewport:{width:390,height:844},tlsVerification:true,pageState,errors,failed,responses,
      pilot:{status:api.status(),state:p.state,publisherConnected:p.publisherConnected,sourceStale:p.sourceStale,receivedAt:p.receivedAt,lastContactAt:p.lastContactAt,sourceAgeMs:p.sourceAgeMs,snapshot:p.snapshot?{accountId:p.snapshot.accountId,inceptionAt:p.snapshot.inceptionAt,runId:p.snapshot.runId,generatedAt:p.snapshot.generatedAt,running:p.snapshot.running,entriesEnabled:p.snapshot.entriesEnabled,source:p.snapshot.source,funnel:p.snapshot.funnel}:null},
      original:{status:original.status(),account:o.snapshot?.account,source:o.snapshot?.source,sequence:o.snapshot?.sequence,generatedAt:o.snapshot?.times?.generatedAt}};
    await page.screenshot({path:'/tmp/poe-dashboard-browser/mobile-full.png',fullPage:true});
    await page.locator('#pilot-telemetry-panel').screenshot({path:'/tmp/poe-dashboard-browser/mobile-pilot.png'});
    fs.writeFileSync('/tmp/poe-dashboard-browser/result.json',JSON.stringify(facts,null,2)+'\n');
    console.log(JSON.stringify(facts,null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error('Mobile verification failed: '+String(e.message).slice(0,700));process.exitCode=1});
