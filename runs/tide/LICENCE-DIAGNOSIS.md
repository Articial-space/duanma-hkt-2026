# Tide licence failure — root cause (2026-10-22, systematic debugging)

**Root cause: TideCloak image `tideorg/tidecloak-dev:0.14.41` (= `latest`, published 2026-10-19) fails free-tier licence activation; `0.14.40` succeeds with identical inputs.**

| Test (one variable each) | Result |
|---|---|
| 0.14.41, 4 fresh realms (incl. wiped container) | `TIDE-IDPEXT-VENDOR-KEYGEN_FAILED`; log `Midgard FinalizeWallet failed … Not enough orks returned an ok response`, one ORK 404; ~10 s (real outbound call) |
| Clock host vs container | in sync (1 s) |
| Cloudflare WARP | disconnected |
| ORK reachability | ork1 200 from host; DNS resolves in container; ork1 reports version 0.14.41 |
| Our `setUpTideRealm` call vs pack playbook `bootstrap-realm-from-template` | identical (form-encoded email, isRagnarokEnabled=true) |
| 0.14.41, fresh realm, `skipLicense=true` | 200 `idp-created` in 1 s → failure isolated to licence activation (matches pack GAP-066 pattern) |
| **0.14.40**, fresh container + realm, same email | **`Finalized wallet for realm truthvoice, vvkId …`** → licence OK, invite link issued |

Our own error found on the way: retrying `setUpTideRealm` on a half-initialised realm gives `VENDOR-REALM_SETUP_FAILED` (Duplicate resource) — always retest on a fresh realm (pack rule).
Also fixed: admin password no longer on the command line (AP-41); it lives in `E:\tidecloak.env` outside the repo.

Pin: server `tideorg/tidecloak-dev:0.14.40`; SDK packages should match 0.14.40.
