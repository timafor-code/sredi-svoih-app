# Mobile Guest Release Checklist

## Automated gate

Run from the repository root:

```powershell
npm run check:mobile-guest-release
npm run typecheck
npx expo config --type public
git diff --check
```

The aggregate checker runs the mandatory existing validators for the capability matrix; guest boot, authentication, token, route, Events, and contacts boundaries; guest Settings; local prayer and notification settings; prayer provider selection, actions, history, and repository behavior; local preferences and legacy migration; the encrypted local-data foundation; and Home parsha content.

It proves that the checked source and unit-level contracts currently pass together. It does not run a browser, Expo, simulator, device, EAS build, TestFlight, backend, or network smoke. Passing this checker, typecheck, Expo public-config review, and `git diff --check` is required before PR 16. Passing the automated gate is not proof of App Store or TestFlight runtime behavior.

## Fresh install — owner manual smoke

- [ ] The app starts without login, password, or signup UI.
- [ ] Home loads.
- [ ] The Hebrew/Jewish date is correct.
- [ ] Weekly parsha content is correct, including translated and holiday-reading states.
- [ ] There is no hardcoded teacher-row regression.
- [ ] The city can be changed.
- [ ] The city remains selected after restart where supported by the tested build.
- [ ] Settings is shown instead of the account Profile surface.
- [ ] Nusach and other local preferences UI works.
- [ ] Prayer UI opens and records without an account.
- [ ] Events loads anonymously.
- [ ] Events has no “Для участников” guest filter.
- [ ] Event category chips are not duplicated.
- [ ] There is no React duplicate-key warning.
- [ ] Public event detail opens.
- [ ] Internal event registration shows a neutral unavailable state, without a login invitation.
- [ ] No account-only route is visible or reachable.
- [ ] Community contacts are not loaded.
- [ ] iPhone contacts remain controlled by the device permission flow.

## Upgrade from current beta/account build — owner manual smoke

- [ ] The guest update does not restore the account session.
- [ ] An old bearer token is not attached to anonymous requests.
- [ ] The server account is not deleted.
- [ ] Server prayer history is not deleted.
- [ ] Old account and invite UI is not exposed.
- [ ] Supported existing local settings migrate once.
- [ ] A second launch does not repeat or destructively reset migration.
- [ ] Newer local preference values are not overwritten by a migration retry.

## Expo Go limitation

Expo Go is valid for manual UI, navigation, and public-API smoke.

Expo Go is **not** valid proof of encrypted local prayer or settings persistence. The current local database intentionally fails closed in Expo Go when the required SQLCipher runtime is unavailable. Do not claim SQLCipher persistence was tested in Expo Go.

## EAS development build / TestFlight encrypted-storage smoke

- [ ] The encrypted local database initializes.
- [ ] Prayer activity can be recorded locally.
- [ ] Prayer history survives an app restart.
- [ ] Prayer history survives a device restart where practical.
- [ ] Local preferences survive restart.
- [ ] The database cannot simply be read as plaintext.
- [ ] The SQLCipher key is absent from the JS bundle, public Expo config/environment output, logs, and analytics.
- [ ] Missing-key or corrupt-key recovery does not silently delete local data.
- [ ] User data is not uploaded merely because encrypted local storage initialized.

## Final release prerequisites

PR 16 must not proceed to publishing until:

- [ ] The automated guest gate passes.
- [ ] `npm run typecheck` passes.
- [ ] Expo public-config review passes.
- [ ] The owner fresh-install smoke passes.
- [ ] The owner upgrade smoke passes.
- [ ] Encrypted-storage smoke passes in an EAS development build or TestFlight.
- [ ] Privacy, legal, and hosting gates are approved by the project owner.
