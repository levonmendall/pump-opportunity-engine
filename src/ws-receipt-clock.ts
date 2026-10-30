/** ws8.22 receive-backlog clock. Source receipt is a conservative application-
 * transport lower bound, not a wire timestamp. Asynchronous message delivery
 * must not let a later TCP chunk make an older queued frame look fresh.
 *
 * Writable.writableLength is public. The pinned Receiver framing fields below
 * are checked explicitly because a partial frame can have writableLength0.
 * Unknown layouts fail closed rather than clearing the receipt bound. */
export class WsReceiptClock {
 private firstAt:number|null=null;private queued=false;
 constructor(private readonly receiver:()=>{writableLength:number;_state:number;_bufferedBytes:number;_fragmented:number;destroyed?:boolean}|undefined,private readonly schedule:(work:()=>void)=>void=work=>{setImmediate(work);}){}
 private drained(){const r=this.receiver();return r!==undefined&&r.destroyed!==true&&r.writableLength===0&&r._state===0&&r._bufferedBytes===0&&r._fragmented===0;}
 chunk(at:number){if(this.drained())this.firstAt=null;this.firstAt??=at;this.check();}
 receivedAt(applicationAt:number){return this.firstAt??applicationAt;}
 private check(){if(this.queued)return;this.queued=true;this.schedule(()=>{this.queued=false;const receiver=this.receiver();if(!receiver||receiver.destroyed===true)return;
  if(!Number.isSafeInteger(receiver.writableLength)||receiver.writableLength<0||!Number.isInteger(receiver._state)||receiver._state<0||receiver._state>6||!Number.isSafeInteger(receiver._bufferedBytes)||receiver._bufferedBytes<0||![0,1,2].includes(receiver._fragmented))return;
  // GET_INFO=0 in the pinned ws8.22 Receiver; no partially read frame remains.
  if(receiver.writableLength===0&&receiver._state===0&&receiver._bufferedBytes===0&&receiver._fragmented===0){this.firstAt=null;return;}
  // A partial frame waiting for another chunk must retain the original bound,
  // without a busy local callback loop while no more bytes are available.
  if(receiver.writableLength>0)this.check();
 });}
}
