/** Read-only startup closure verification for the separately built native PAPER
 * executable. This is provenance validation, never financial initialization. */
import {constants,openSync,closeSync,fstatSync,readFileSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
export const NATIVE_PAPER_BUNDLE_KIND='poe-native-paper-bundle-v1';
type BoundFile={file:string;bytes:number;sha256:string};
export type NativePaperBundleClosure={kind:typeof NATIVE_PAPER_BUNDLE_KIND;commit:string;platform:'linux';architecture:'x64';nodeMajor:24;nodeAbi:'137';sqliteVersion:'13.0.3';addon:BoundFile;worker:BoundFile;lockSha256:string};
declare const __POE_NATIVE_PAPER_CLOSURE__:NativePaperBundleClosure|undefined;
const need=(v:unknown,r:string)=>{if(!v)throw Error(r);};
const sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
function bounded(path:string,maximum:number){const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const before=fstatSync(fd);need(before.isFile()&&before.nlink===1&&before.uid===process.getuid?.()&&(before.mode&0o022)===0&&before.size>0&&before.size<=maximum,'NATIVE_PAPER_BUNDLE_PRIVATE_REGULAR_FILE');const bytes=readFileSync(fd),after=fstatSync(fd);need(bytes.length===before.size&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'NATIVE_PAPER_BUNDLE_FILE_CHANGED');return bytes;}finally{closeSync(fd);}}
function checkedFile(directory:string,row:BoundFile,expectedName:string,maximum:number){need(row?.file===expectedName&&Number.isSafeInteger(row.bytes)&&row.bytes>0&&row.bytes<=maximum&&/^[a-f0-9]{64}$/.test(row.sha256),'NATIVE_PAPER_BUNDLE_FILE_SPECIFICATION');const bytes=bounded(join(directory,expectedName),maximum);need(bytes.length===row.bytes&&sha(bytes)===row.sha256,'NATIVE_PAPER_BUNDLE_CLOSURE_HASH_MISMATCH');}
export function verifyNativePaperBundleSource(path:string,input:{commit:string;sha256:string}){
 need(typeof __POE_NATIVE_PAPER_CLOSURE__!=='undefined','NATIVE_PAPER_VERIFIED_BUNDLE_CLOSURE_REQUIRED');const closure=__POE_NATIVE_PAPER_CLOSURE__!;
 need(closure.kind===NATIVE_PAPER_BUNDLE_KIND&&/^[a-f0-9]{40}$/.test(input.commit)&&/^[a-f0-9]{64}$/.test(input.sha256)&&input.commit===closure.commit,'NATIVE_PAPER_BUNDLE_INPUT_IDENTITY');
 need(path.endsWith('/native-paper.mjs')&&process.platform===closure.platform&&process.arch===closure.architecture&&Number(process.versions.node.split('.')[0])===closure.nodeMajor&&process.versions.modules===closure.nodeAbi&&Boolean((process.report.getReport() as {header?:{glibcVersionRuntime?:string}}).header?.glibcVersionRuntime),'NATIVE_PAPER_BUNDLE_PLATFORM_REQUIRED');
 const directory=dirname(path),s=lstatSync(directory);need(s.isDirectory()&&!s.isSymbolicLink()&&realpathSync(directory)===directory&&s.uid===process.getuid?.()&&(s.mode&0o077)===0,'NATIVE_PAPER_BUNDLE_PRIVATE_DIRECTORY');
 const raw=bounded(join(directory,'metadata.json'),4*1024*1024),metadata=JSON.parse(raw.toString());need(metadata.schemaVersion===1&&metadata.kind===NATIVE_PAPER_BUNDLE_KIND&&metadata.git?.commit===closure.commit&&metadata.git?.workingTreeStatus===''&&metadata.liveTradingEnabled===false&&metadata.financialMode==='PAPER'&&JSON.stringify(metadata.closure)===JSON.stringify(closure),'NATIVE_PAPER_BUNDLE_METADATA_IDENTITY');
 const body=bounded(path,16*1024*1024);need(metadata.bundle?.file==='native-paper.mjs'&&metadata.bundle.bytes===body.length&&metadata.bundle.sha256===sha(body)&&input.sha256===metadata.bundle.sha256,'NATIVE_PAPER_BUNDLE_EXECUTABLE_HASH_MISMATCH');
 checkedFile(directory,closure.addon,'better_sqlite3.node',16*1024*1024);checkedFile(directory,closure.worker,'backup-worker.mjs',16*1024*1024);
 return Object.freeze({commit:closure.commit,sha256:input.sha256,kind:'immutable-startup-native-paper-bundle-closure',metadataSha256:sha(raw),sqliteVersion:closure.sqliteVersion,addonSha256:closure.addon.sha256,backupWorkerSha256:closure.worker.sha256,packageLockSha256:closure.lockSha256});
}
