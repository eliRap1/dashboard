# Security Advisories — 2026-06-08

These advisories were identified by `npm audit` but cannot be fixed without major version bumps (which are out of scope for routine patch/minor hygiene).

| Severity | Package | Fix Available | Blocker |
|----------|---------|---------------|---------|
| HIGH | next | next ≥ 16.x | Current: 14.x — major bump required |
| HIGH | @next/eslint-plugin-next | eslint-config-next ≥ 16.x | Major bump required |
| HIGH | eslint-config-next | eslint-config-next ≥ 16.x | Major bump required |
| HIGH | glob | eslint-config-next ≥ 16.x | Major bump required |
| CRITICAL | vitest | vitest ≥ 4.1.8 | Current: ^3.x — major bump required |

Please schedule a dedicated PR to upgrade next 14→16 and vitest 3→4.
