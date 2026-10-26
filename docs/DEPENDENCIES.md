# Dependency decisions

Verified 2026-10-26. The package lock pins the current official PumpSwap SDK
2.2.0 with web3.js 1.98.4 and SPL Token 0.4.14. Registry version inspection and
installed source take precedence over older public-docs version examples.
Do not run `npm audit fix --force`: its suggested SDK 1.0.0/SPL 0.1.8 downgrades
lose current protocol compatibility.

## Bounded remediation

- Anchor's `toml` dependency is overridden to 5.0.1. Its parser security fixes
  address current advisories. Anchor only reads local Anchor.toml through its
  workspace helper; the POE market-data path does not invoke that helper. A
  representative local configuration parsing test protects the compatible API.
- web3.js's `jayson` dependency is overridden to 5.0.0. It retains the CommonJS
  browser-client constructor/request/callback API used by web3.js, while removing
  vulnerable `uuid` and `stream-json` dependencies. Upgrading stream-json alone
  would break Jayson 4's CommonJS paths. Tests exercise a mocked JSON-RPC callback
  and the actual SDK/PDA/decoder/quote imports after this override.
- `bigint-buffer` latest remains 1.1.5, with no patched release listed for
  [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg).
  `scripts/patch-bigint-buffer.mjs` runs at installation and changes only its
  native-binding selector to force the **package's existing pure-JS fallback**.
  The script requires exactly version 1.1.5 and the SHA-256 of the published
  original source; it accepts an identical already-patched file and rejects
  unreviewed changes. No pricing or integer algorithms are replaced. Tests check
  u64 endian roundtrips, actual SPL layouts, and absence of the native binding
  from loaded modules. The vulnerable native file may exist on disk but is not
  loaded by POE's dependency path.

Use `npm ci`, including lifecycle scripts, followed by `npm run build` and
`npm test`. **Do not install with `--ignore-scripts`** or remove the postinstall
step. After dependency changes, review the exact-version/source check and rerun
the compatibility tests. Native integer conversion must stay unavailable.

## Remaining scanner results

The npm audit scanner uses package versions and cannot recognize the local
native-path mitigation. It continues reporting bigint-buffer and its three
dependent packages as high severity. Report those findings as mitigated runtime
exposure, not a clean audit. Revisit when a maintained patched upstream version
is available. The current path reads fixed-width integer slices and retains
bounded incoming account data; neither fact alone substitutes for the patch.

The development-only esbuild 0.27.7 Windows development-server advisory is also
reported. POE runs Linux and does not start esbuild's development server; it uses
tsx for compilation. This remains a disclosed dependency finding, with no claim
of universal safety. No signer, provider trading API, or transaction submission
was invoked by these tests. Fixture quotes do not establish Gate A's real-data
integration or PAPER performance.
