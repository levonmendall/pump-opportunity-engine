/** Bounded, conservative one-second receipt buckets. These are local rolling
 * resource controls, not provider entitlement or lifetime traffic allowances. */
export class PersistentDataWindow {
 private readonly buckets:Array<{start:number;bytes:number}>=[];private observedAt=-Infinity;
 constructor(readonly maximumBytes:number,readonly windowMs=60000){if(!Number.isSafeInteger(maximumBytes)||maximumBytes<1||!Number.isSafeInteger(windowMs)||windowMs<1000||windowMs>600000)throw Error('PERSISTENT_DATA_WINDOW_OPTIONS');}
 private prune(at:number){if(!Number.isFinite(at)||at<0||at<this.observedAt)throw Error('PERSISTENT_DATA_WINDOW_CLOCK');this.observedAt=at;while(this.buckets.length&&this.buckets[0]!.start+1000<=at-this.windowMs)this.buckets.shift();}
 observe(at:number,bytes:number){if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('PERSISTENT_DATA_WINDOW_BYTES');this.prune(at);if(bytes){const start=Math.floor(at/1000)*1000,last=this.buckets.at(-1);if(last?.start===start)last.bytes+=bytes;else this.buckets.push({start,bytes});}return this.view(at);}
 view(at:number){this.prune(at);const bytes=this.buckets.reduce((n,b)=>n+b.bytes,0),pressure=bytes>this.maximumBytes;let remaining=bytes,recoveryAt=at;for(const b of this.buckets){if(remaining<=this.maximumBytes)break;remaining-=b.bytes;recoveryAt=b.start+1000+this.windowMs;}return {windowMs:this.windowMs,maximumBytes:this.maximumBytes,receivedBytes:bytes,pressure,recoveryAfterMs:Math.max(0,recoveryAt-at),retainedBuckets:this.buckets.length,meaning:'Conservative rolling receipt buckets; expiry can lag the exact receipt by less than1s. All received bytes remain in cumulative accounting.'};}
}
