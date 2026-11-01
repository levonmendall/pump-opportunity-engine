/** Receipt provenance for the uncompressed, unmasked server frames used by the
 * pinned selected-flow WebSocket. This observer never decodes/admits market
 * data: ws remains the protocol/UTF-8 validator. It retains only header bytes
 * and event timestamps, never a second copy of payloads.
 *
 * A continuously nonempty Receiver is not one message. Each message is stamped
 * with its own first frame byte; continuations retain the first fragment's
 * stamp. A later chunk can neither refresh an older packet nor age a newer one.
 */
export const WS_FRAME_RECEIPT_POLICY=Object.freeze({version:'ws-frame-first-byte-receipt-v1',maximumPayloadBytes:512*1024,maximumPendingEvents:32768});
type Kind='message'|'ping'|'pong';
type Receipt={kind:Kind;receivedAt:number;completedAt:number};
export class WsFrameReceiptClock {
 private readonly header=Buffer.alloc(10);private headerBytes=0;private headerLength=2;
 private frameAt:number|null=null;private payloadLeft=0;private opcode=0;private fin=false;
 private messageAt:number|null=null;private messageBytes=0;private control=false;
 private readonly events:Receipt[]=[];private head=0;private ended=false;private failed=false;
 private lastChunkAt=-Infinity;private frames=0;private messages=0;private maximumQueue=0;
 private maximumHandlerQueueMs=0;private maximumMessageSpanMs=0;
 private need(ok:unknown,reason:string):asserts ok{if(!ok){this.failed=true;throw Error('WS_FRAME_RECEIPT_'+reason);}}
 chunk(data:Uint8Array,at:number):void {
  this.need(!this.failed,'UNAVAILABLE');this.need(Number.isSafeInteger(at)&&at>=0&&at>=this.lastChunkAt,'CLOCK');
  this.lastChunkAt=at;if(this.ended||data.byteLength===0)return;
  let offset=0;
  while(offset<data.byteLength&&!this.ended){
   if(this.payloadLeft>0){const count=Math.min(this.payloadLeft,data.byteLength-offset);this.payloadLeft-=count;offset+=count;if(this.payloadLeft===0)this.complete(at);continue;}
   if(this.headerBytes===0)this.frameAt=at;
   const count=Math.min(this.headerLength-this.headerBytes,data.byteLength-offset);
   this.header.set(data.subarray(offset,offset+count),this.headerBytes);this.headerBytes+=count;offset+=count;
   if(this.headerBytes<this.headerLength)continue;
   if(this.headerLength===2){
    const a=this.header[0]!,b=this.header[1]!,length=b&127;
    this.need((a&112)===0&&(b&128)===0,'UNNEGOTIATED_FRAMING');this.opcode=a&15;this.fin=(a&128)!==0;this.control=this.opcode>=8;
    this.need([0,1,2,8,9,10].includes(this.opcode),'OPCODE');
    this.need(!this.control||this.fin&&length<=125,'CONTROL_FRAME');
    this.headerLength=length===126?4:length===127?10:2;if(this.headerLength>2)continue;
   }
   let length=this.header[1]!&127;
   if(length===126){length=this.header.readUInt16BE(2);this.need(length>=126,'NONCANONICAL_LENGTH');}
   else if(length===127){const n=this.header.readBigUInt64BE(2);this.need(n>65535n&&n<=BigInt(WS_FRAME_RECEIPT_POLICY.maximumPayloadBytes),'PAYLOAD_BOUND');length=Number(n);}
   this.need(length<=WS_FRAME_RECEIPT_POLICY.maximumPayloadBytes,'PAYLOAD_BOUND');
   if(!this.control){
    if(this.opcode===0)this.need(this.messageAt!==null,'CONTINUATION');
    else{this.need(this.messageAt===null,'FRAGMENT_SEQUENCE');this.messageAt=this.frameAt;this.messageBytes=0;}
    this.messageBytes+=length;this.need(this.messageBytes<=WS_FRAME_RECEIPT_POLICY.maximumPayloadBytes,'MESSAGE_BOUND');
   }
   this.payloadLeft=length;if(length===0)this.complete(at);
  }
 }
 private complete(at:number){
  this.frames++;
  const kind:Kind|null=this.opcode===9?'ping':this.opcode===10?'pong':!this.control&&this.fin?'message':null;
  if(kind){
   this.need(this.events.length-this.head<WS_FRAME_RECEIPT_POLICY.maximumPendingEvents,'EVENT_CAPACITY');
   const receivedAt=kind==='message'?this.messageAt:this.frameAt;this.need(receivedAt!==null&&receivedAt<=at,'PROVENANCE');
   this.events.push({kind,receivedAt,completedAt:at});this.maximumQueue=Math.max(this.maximumQueue,this.events.length-this.head);
   if(kind==='message'){this.messages++;this.maximumMessageSpanMs=Math.max(this.maximumMessageSpanMs,at-receivedAt);this.messageAt=null;this.messageBytes=0;}
  }
  if(this.opcode===8)this.ended=true;
  this.headerBytes=0;this.headerLength=2;this.frameAt=null;this.payloadLeft=0;
 }
 take(kind:Kind,handledAt:number):Receipt{
  this.need(!this.failed,'UNAVAILABLE');const receipt=this.events[this.head];
  this.need(receipt&&receipt.kind===kind&&Number.isSafeInteger(handledAt)&&receipt.completedAt<=handledAt,'EVENT_ORDER');
  this.head++;this.maximumHandlerQueueMs=Math.max(this.maximumHandlerQueueMs,handledAt-receipt.completedAt);
  if(this.head===this.events.length){this.events.length=0;this.head=0;}
  else if(this.head>=1024){this.events.splice(0,this.head);this.head=0;}
  return {...receipt};
 }
 usage(){return {version:WS_FRAME_RECEIPT_POLICY.version,frames:this.frames,messages:this.messages,pendingEvents:this.events.length-this.head,maximumPendingEvents:this.maximumQueue,maximumHandlerQueueMs:this.maximumHandlerQueueMs,maximumMessageSpanMs:this.maximumMessageSpanMs,partialMessage:this.messageAt!==null,failed:this.failed};}
}
