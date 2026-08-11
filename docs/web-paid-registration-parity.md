# Public web paid-registration parity

The five-PR `webregmob.md` public-web registration parity series is complete.
It delivers mobile-domain parity for participation options while preserving the
existing public-web identity, legal, questionnaire, occurrence, email
verification, and canonical-registration architecture. It does not collect a
payment or claim that payment has completed.

## Series closure

- PR #377, contract foundation (PR 1): completed the strict
  `internal_free | internal_paid` and canonical option contract.
- PR #378, paid option UI (PR 2): completed paid, donation, type, quantity, and
  capacity-display semantics.
- PR #379, totals (PR 3): completed browser display totals, seat totals, and
  mixed-currency fail-closed behavior.
- PR #380, gated backend activation (PR 4): completed enumeration-safe,
  default-off `internal_paid` publication, intent, email confirmation, and
  canonical `pending/pending` finalization.
- `test/web-mobile-registration-parity` (PR 5): adds the aggregate automated
  parity guard and final documentation and owner checklist, completing the
  series without new product behavior.

Two later supporting PRs are already merged but are not part of the original
five-PR series: PR #381 adds the local Mailpit E2E stack, and PR #382 refines the
admin registration operations layout.

## Canonical matrix

| Contract | Availability and options | Quantity, capacity, and money | Confirmation result |
| --- | --- | --- | --- |
| `internal_free` | Public form supported; free option supported; paid and donation options excluded by the free-only contract | Existing free option and seat behavior remains unchanged | Existing email-confirmed success behavior remains unchanged |
| `internal_paid` | Public form supported only behind the backend gate; paid options, canonically allowed free participation, and donation are supported | Quantity and `group_key` are supported; donation and `counts_toward_capacity=false` options do not occupy seats; price/currency and snapshots are server-calculated | `registration.status=pending` and `payment_status=pending` |
| gate `false` | Paid public form is enumeration-safe unavailable | Production default; free events are unaffected | No paid public flow begins |
| gate `true` | Paid public form is available in an allowed environment | Canonical paid validation and confirmation apply | Email verification remains mandatory before `pending/pending` registration creation |

Mixed selected currencies fail closed: the browser blocks submission, the
backend rejects canonical validation, and aggregation never combines different
currencies. There is no currency conversion.

## Server ownership

Browser values are never authoritative for:

- `unit_price_amount`;
- `total_amount`;
- `total_currency`;
- `is_donation`;
- `counts_toward_capacity`;
- the final capacity result.

The browser computes display totals only. Selected option IDs and quantities are
canonical inputs, but the backend revalidates option ownership and activity,
quantity bounds and duplicates, client `seats_count`, donation-only requests,
mixed currency, and capacity. It uses current server-owned prices, creates the
option snapshots, and rechecks capacity during confirmation. An intent does not
reserve final capacity. Confirmation and replay are idempotent and do not create
duplicate registrations.

## Local E2E support

PR #381 provides Mailpit for local development while retaining the real SMTP
delivery path. Verification is not bypassed. Local/test environments may enable
the paid gate with an environment override; the production default remains
`false`. This parity closure makes no infrastructure changes.

## Automated parity guard

The canonical regression command is:

```text
npm run check:web-registration-parity
```

It verifies the default-off backend gate, runs the focused public-web Vitest
suites, and runs the focused backend publication, intent, and email-finalization
pytest suites through the repository-local Docker stack. It does not open a
browser or run browser, Expo, iPhone, or manual smoke.

## Owner manual-smoke checklist

Not run by Codex. Browser smoke is performed manually by the project owner on
the pushed PR branch.

### Free event

- [ ] canonical slug URL opens;
- [ ] occurrence flow matches PR #376;
- [ ] free option works;
- [ ] email verification works;
- [ ] registration confirms as before.

### Paid event, gate=false

- [ ] paid public form remains unavailable;
- [ ] behavior remains enumeration-safe;
- [ ] free events are unaffected.

### Paid event, gate=true in local/test

- [ ] paid options visible;
- [ ] type chips correct;
- [ ] price correct;
- [ ] donation separated;
- [ ] quantity respects min/max;
- [ ] donation changes amount but not seats;
- [ ] non-capacity option does not increase seats;
- [ ] total matches options;
- [ ] email verification works through Mailpit/local SMTP;
- [ ] confirmation creates registration;
- [ ] success does not claim payment completed;
- [ ] server result is `pending/pending`;
- [ ] retry/replay does not create duplicate registration;
- [ ] capacity race is rejected by backend.

## Future payment-provider boundary

Real acquiring is a new series, not unfinished work in this parity series. At a
high level it must cover provider selection, Russian acquiring/payment
integration, 54-FZ and fiscalization considerations, server-side payment
intent, signed webhooks, idempotency, payment-to-registration state transition,
timeout/cancel/retry handling, a capacity-hold strategy, refunds, admin
reconciliation, receipts, and observability without PII or card data.

None of that is implemented here. After this PR, the `webregmob.md` five-PR
parity series is complete; no additional parity PR is required.
