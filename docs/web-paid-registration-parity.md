# Public web paid-registration parity

This PR establishes public registration-form contract support for paid-participation semantics. The event payload exposes `registration_mode` as the strict `internal_free | internal_paid` domain, and participation-option payloads expose the canonical `is_donation` flag from the backend option row.

The API/web types understand `internal_paid`, but public paid registration is **NOT enabled by this PR**.

The production public flow remains restricted to `internal_free`. Paid public routes remain unavailable, the live form continues to return only free non-donation options, and web registration-intent preflight continues to use `free_only=True`. No payment gateway or provider integration is implemented.

Later PRs will add paid-option UI semantics, totals, and feature-gated backend activation. This foundation does not add payment intents, webhooks, payment tables, paid-status transitions, donation UI, or quantity/totals UI.
