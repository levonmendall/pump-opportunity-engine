export function wsWire(payload:Buffer,opcode=1,fin=true):Buffer{
 const size=payload.length,header=Buffer.alloc(size<126?2:size<=65535?4:10);
 header[0]=(fin?128:0)|opcode;header[1]=size<126?size:size<=65535?126:127;
 if(size>=126&&size<=65535)header.writeUInt16BE(size,2);
 else if(size>65535)header.writeBigUInt64BE(BigInt(size),2);
 return Buffer.concat([header,payload]);
}
