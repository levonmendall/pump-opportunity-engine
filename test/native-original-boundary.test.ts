/** Actual supervisor-generated nonsecret child environment → TypeScript binding.
 * This resolves a path only and never reads a credential. */
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {publisherCredentialPath} from '../src/snapshot-publisher.js';
test('actual original publisher child environment resolves the existing systemd credential without a second secret',()=>{
 const env=JSON.parse(readFileSync('operator/native-paper-ec2/fixture-authoritative-publisher-env.json','utf8')) as NodeJS.ProcessEnv;
 assert.equal(publisherCredentialPath(env),'/run/credentials/poe-runtime.service/poe-ingest-secret');assert.equal(env.POE_PUBLISH_SECRET_FILE,env.CREDENTIALS_DIRECTORY+'/poe-ingest-secret');
 const {CREDENTIALS_DIRECTORY:_,...missing}=env;assert.throws(()=>publisherCredentialPath(missing),/CREDENTIAL_BINDING/);assert.throws(()=>publisherCredentialPath({...env,CREDENTIALS_DIRECTORY:'/run/credentials/another.service'}),/CREDENTIAL_BINDING/);assert.throws(()=>publisherCredentialPath({...env,POE_PUBLISH_SECRET_FILE:'/tmp/arbitrary-secret'}),/CREDENTIAL_BINDING/);assert.ok(!Object.keys(env).some(k=>/TOKEN|PRIVATE_KEY|PASSWORD|INGEST_SECRET$/.test(k)));
});
