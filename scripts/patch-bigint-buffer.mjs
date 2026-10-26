import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// bigint-buffer 1.1.5 has no patched registry release for GHSA-3gc7-fjrx-p6mg.
// Keep its shipped JS algorithms and remove only native-binding selection. Fail
// closed if a different version/content appears; never silently patch new code.
const require = createRequire(import.meta.url);
const target = require.resolve('bigint-buffer');
const manifest = JSON.parse(readFileSync(join(dirname(target), '..', 'package.json'), 'utf8'));
if (manifest.name !== 'bigint-buffer' || manifest.version !== '1.1.5') {
  throw new Error('Unreviewed bigint-buffer version; review fallback patch before installation');
}
const originalHash = '6882e3d44987bbb7c47580928fd5e3be126bdae26a448f8a31228cf879a85210';
const nativeSelector = `let converter;
{
    try {
        converter = require('bindings')('bigint_buffer');
    }
    catch (e) {
        console.warn('bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)');
    }
}`;
const replacement = `// POE: force the package's shipped pure-JS fallback; native path is vulnerable.
const converter = undefined;`;
const hash = text => createHash('sha256').update(text).digest('hex');
const source = readFileSync(target, 'utf8');
if (hash(source) === originalHash) {
  if (!source.includes(nativeSelector)) throw new Error('bigint-buffer selector did not match');
  writeFileSync(target, source.replace(nativeSelector, replacement));
} else {
  const reverted = source.replace(replacement, nativeSelector);
  if (source === reverted || hash(reverted) !== originalHash) {
    throw new Error('Unreviewed bigint-buffer contents; installation stopped');
  }
}
console.log('bigint-buffer@1.1.5: verified pure-JS fallback active');
