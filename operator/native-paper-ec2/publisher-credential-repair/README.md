Reporting-only original-service repair

Financial source remains 5e55d8b939de99698ddb311a282461931fcbc957. Reporter source 5735db2ca8abc6af6f99bb0ad855c19cdebaf864. Existing account, secret, channel, ledger, strategy, and running supervisor are preserved.

The owner observed a root:root 0440 systemd credential. The old publisher rejects group-read metadata. Only this exact service credential path gains compatibility; actual nonroot kernel read access still requires host verification.

Stage the two exact reviewed files with the existing administration staging workflow. OWNER_APPLY.txt is the one-time root command; its loader checks source owner, file type/link count/size/permissions and exact driver hash before executing isolated Python. No sudoers changes or new service are required.

Installer preserves root-only before/after images and the reviewed driver under /etc/poe/cutovers/<financial-source>/reporting-credential-v1/. It atomically replaces only snapshot-publisher.mjs and the corresponding hash/size row in /etc/poe/native-engine.json. The old immutable package/index is retained unchanged; this is an explicitly recorded reporting hotfix, not a claim that the entire release still matches its original package. Other release files are verified unchanged. No financial database or secret contents are read and no service control operation is issued.

A crash between the two adjacent atomic replacements may leave a mismatched disk pair. Rerun the same reviewed installer (or root-retained copy with the same hash); it accepts only the known before/after states and completes the pair. Do not restart the financial manager to repair that pair.

The existing supervisor retries its own publisher. The installer observes for at most95 seconds and requires two distinct accepted original-source timestamps under the same supervisor, otherwise exits nonzero with installed/incomplete state retained. The public metadata receipt is /var/lib/poe-public/reporting-repair.json. This proves reporting delivery only, not trading readiness or financial acceptance. Independently compare Render with the accepted-source metadata afterward.

OWNER_ROLLBACK.txt restores ONLY the previous reporting artifact and manifest from root-owned images; it does not depend on /var/tmp. It does not stop a healthy already-loaded publisher. The old reporter is used at its next child restart; therefore the receipt explicitly calls this a disk/future-retry rollback. Never restore the financial ledger or revert to the obsolete observer as a reporting rollback.

Validation: 1685 repository tests, TypeScript build/compile,27 focused tests,5 installer guards, exact-bundle synthetic root0440/0644 CLI cases. Synthetic FS metadata does not establish host ACL access; no credentials were consumed in fixtures.

Identity correction: the first staged driver assumed UID=GID=988 and refused before mutation. Actual host run40811531287 proves original UID988, GID982. The v2 stage retains the old refused bytes and uses named user/group matching, all four live process UID/GID values, and preserved root:runtime-group0640 artifact metadata. Nine installer regressions now pass. Reporter executable remains unchanged; no need to rebuild/retest financial logic.
