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
