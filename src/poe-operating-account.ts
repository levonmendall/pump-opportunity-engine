/** The installed original account is the only live operating portfolio.
 * These constants are identity, never instructions to initialize capital. */
export const POE_OPERATING_ACCOUNT=Object.freeze({accountId:'poe-3123e352-4581-455b-85db-acd7e825e99e',inceptionAt:Date.parse('2026-10-26T22:07:36.212Z'),initialMicroUsd:'1000000000',ledgerPath:'/var/lib/poe/state/ledger.sqlite'});
export type OperatingAccountBinding=Readonly<{accountId:string;inceptionAt:number}>;
export function assertPoeOperatingAccount(value:{accountId:string;inceptionAt:number;mode:string;initialMicroUsd:string}){
 if(value.accountId!==POE_OPERATING_ACCOUNT.accountId||value.inceptionAt!==POE_OPERATING_ACCOUNT.inceptionAt||value.initialMicroUsd!==POE_OPERATING_ACCOUNT.initialMicroUsd||value.mode!=='PAPER')throw Error('POE_ORIGINAL_ACCOUNT_IDENTITY_REQUIRED');
}
/** Explicit fixture binding preserves old isolated regression fixtures. The
 * actual launcher never accepts or exposes a fixture binding. */
export function assertNativePaperAccount(value:{accountId:string;inceptionAt:number;mode:string;initialMicroUsd:string},fixture?:OperatingAccountBinding){
 if(!fixture)return assertPoeOperatingAccount(value);
 if(!/^poe-pilot-[a-z0-9-]+$/.test(fixture.accountId)||fixture.accountId!==value.accountId||fixture.inceptionAt!==value.inceptionAt||value.mode!=='PAPER'||value.initialMicroUsd!=='1000000000')throw Error('POE_EXPLICIT_FIXTURE_ACCOUNT_IDENTITY_REQUIRED');
}
