# BIN catalogue release — 2026-09-18

Scope: official admin supplier/BIN catalogue, pricing and immutable source import. Source evidence: Render job-dambc40u01pc73f1nutg, 8 active products, exhausted pagination. No real card/funding writes or issuing-worker activation.

Local verification in isolated worktree based on c283b71:
- `pnpm test`: 102 passed.
- `pnpm typecheck`: client/admin passed.
- `pnpm build:admin`: passed (existing chunk-size warning).
- `bash services/api/scripts/test-postgres.sh`: complete race suite passed, including issuance and catalogue import permission/idempotency/unconfigured/preservation/conflict tests.
- `go vet ./...`: passed.
- Fresh Render backup job-dambeq3m8hqs73d7bag0 downloaded to private storage, checksums verified, successfully restored into moventra_bin_restore_20260918.
- Encrypted SHA-256: 50b41ee0608c94c2789204695ea3535be73b6fc0b07e818a10a9e588c5d95a7d.
- Dump SHA-256: 8364d048b42cccd2c259bf06df9290790dca3a747e5998e714237a704ceb8354.
- Restored baseline migrations 1–5,7–11 verified against unchanged repository files; applied only new012. Existing customer/account/transaction/grant/projection invariants unchanged.
- Real source manifest imported into restored local database: first run8 new drafts, second run0. No guessed prices, card network, or minimum funding.

Production migration, release and browser verification results are recorded below as they complete. Rollback to previous app revision preserves catalogue/audit tables; no data deletion.

## Production execution

- GitHub main: d3a15c0056406823b8bb3ac5dfe1ed39e2c17ac5.
- Migration: job-dambg06k1f9s73eupk1g completed012; old data invariant hashes unchanged.
- Render API: dep-dambg9uk1f9s73euqmr0 live at that commit; healthz/readyz both200.
- Import: job-dambhd6k1f9s73euv3lg completed:8 source products,8 new drafts, audited. Existing active operator received catalog read/write and pricing permissions only.
- Cloudflare admin: f9073123-5d4b-4db5-8aa3-ec35fe7ea6b6; admin.moventra.me and existing alternate domain published.
- Public product catalogue remains unpriced draft; supplier paused. No real Slash financial write, live Blnk configuration or issuing-worker deployment.
- Post-import database verification: job-dambi0lbedkc73apee40 confirmed 8 source mappings/8 draft products, all fee/minimum fields unconfigured, all observed source statuses active; 1 import audit, 0 issuance orders, 0 deposit records, 0 financial grants.
- Browser: opened production /card-bins in a new Chrome tab. Application rendered the normal login page; existing authentication is page-memory only. Authenticated list/detail/refresh acceptance awaits operator login+MFA and is not claimed passed.
- Original dirty workspace remains preserved. The deployed implementation is in the isolated release worktree and GitHub main; do not deploy the old workspace's conflicting migration007.
