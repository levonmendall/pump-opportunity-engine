/** A wire signature must identify a signed transaction. The all-zero default
 * is the SDK's missing-signature sentinel, not confirmed execution evidence. */
import bs58 from 'bs58';
export const DEFAULT_TRANSACTION_SIGNATURE='1'.repeat(64);
export function canonicalTransactionSignature(value:unknown):value is string{
 if(typeof value!=='string'||value.length>100)return false;
 try{const bytes=bs58.decode(value);return bytes.length===64&&bytes.some(n=>n!==0)&&bs58.encode(bytes)===value;}catch{return false;}
}
