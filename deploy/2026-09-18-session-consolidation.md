# Moventra completed-session release — 2026-09-18

Base: main acfc4ec. Scope: unified admin card/transaction ownership, linked card suffix, persisted random card names/default Slash holder, allowlist guidance and card-detail design documentation.

Card identities are read from existing project-wallet assignments or legacy snapshot bindings, independent of source revision. User/customer details require accounts:read in addition to channel access and MFA. Missing grants return restricted; mismatched account/wallet provenance returns scope_mismatch with no identity. No binding writes or migrations. Existing source BIN import and nullable unconfigured price behavior retained.

Validation in the final isolated candidate: 107 frontend/gateway tests; client/admin production builds; full temporary PostgreSQL race suite; Go vet and command builds. Existing large-chunk warning remains. Real Firebase and Blnk tests skipped without their explicit environment. No real card creation, funds movement or database migration performed. Authenticated browser acceptance and real default-holder behavior remain unverified.

API/admin publication results will be recorded after platform verification. Client source/worker unchanged by this release, except shared issuing DTO type (no runtime effect); existing client release remains in place.

Additional local candidates are not included yet: backend configuration drafts/Cregis adapter, merchant registry, Slash lifecycle, shadow sources/financial. Their historical migration numbers overlap deployed schema; they require compatibility review and independent production migration approval. Existing applied migration bytes must remain unchanged. The generic BIN draft route must not overwrite the deployed supplier catalog.
