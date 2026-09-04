# Mobile account release checklist

This checklist is performed manually by the project owner on the pushed PR branch. Codex does not run Expo/iPhone smoke tests.

Use a build with both release capabilities set explicitly:

```text
EXPO_PUBLIC_APP_ACCESS_MODE=account
EXPO_PUBLIC_EVENT_REGISTRATION_MODE=account
```

For local Expo Go testing, put these non-secret values in the owner's uncommitted `.env.local`. Do not commit that file.

## Fresh install / signed out

- [ ] The app launches successfully.
- [ ] The Profile tab shows login and registration instead of the Guest Settings shell.
- [ ] The registration tab is available.
- [ ] Email and password validation works with the existing requirements.
- [ ] No `DEV-SREDI-2026` or other built-in test invite copy appears.
- [ ] Public events load while signed out.

## New account

New account manual flow: register → receive verification email → enter code → authenticated → onboarding.

- [ ] Create an account with email and password.
- [ ] The app does not become authenticated immediately after registration.
- [ ] The verification-code screen appears and a verification email arrives.
- [ ] An invalid code does not authenticate the app.
- [ ] Entering the correct code logs in and the session becomes authenticated.
- [ ] Profile onboarding opens and can be completed.
- [ ] Restart the app and confirm that the API session is restored.
- [ ] Sign out, then sign in again with the same account.
- [ ] Resending the verification email works.
- [ ] For a pre-existing unverified account: sign-in is blocked, the recovery verification screen is offered, and signing in succeeds after entering the code.
- [ ] Wrong password on sign-in still shows a normal invalid-credentials error, not the verification screen.

## Existing account

- [ ] An existing API user can sign in.
- [ ] The existing profile loads.
- [ ] Memberships load.
- [ ] My registrations loads.

## Invite

- [ ] A real invite code can be entered and accepted.
- [ ] No built-in or test invite is exposed in the UI.
- [ ] The active membership survives reload.

## Event registration

- [ ] An `internal_free` account registration opens.
- [ ] Occurrence selection works where applicable.
- [ ] The registration persists after reload.
- [ ] My registrations shows the registration.
- [ ] Cancellation continues to work.
- [ ] Existing `internal_paid` placeholder/test behavior is unchanged by this PR.

## Privacy and local data

- [ ] Existing local prayer history is not deleted.
- [ ] Signing in does not automatically upload local prayer history.
- [ ] Signing out does not erase local prayer history.
- [ ] Account activation does not change prayer data without an explicit user action.

## Expo Go and encrypted persistence

- [ ] Expo/iPhone smoke is performed by the project owner.
- [ ] Expo Go is used only for the supported UI smoke scenarios.
- [ ] SQLCipher encrypted persistence is validated in an EAS development build or TestFlight, not in Expo Go.
