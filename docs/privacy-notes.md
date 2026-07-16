# Privacy

> Historical provider-switch notes below are retained for audit context. Mobile
> and web-admin production use the Python API only and do not use a Supabase
> frontend fallback.

- Контакты читаются локально через `expo-contacts`.
- Автоматической отправки всех контактов на сервер нет.
- Для серверной синхронизации предусмотрен отдельный consent flow.
- Для phone/email в synced_contacts предусмотрены hash-поля.

## Community contacts API (PR 32E)

- `GET /community/contacts` returns the existing member directory only to an
  authenticated active member of the selected community. It is built from
  profiles and active memberships, not from the separate `community_contacts`
  table.
- Current directory privacy is controlled by `profiles.profile_visibility`,
  `profiles.phone_visibility`, and `profiles.birthday_visibility`.
  `profile_contact_visibility` is legacy/current-user settings data only and
  has no effect on the directory.
- Members and `event_manager` actors do not receive `rabbi_only` profile,
  phone, or birthday data. `admin` and `rabbi` actors may receive it only for
  their own active community. Email remains hidden for every viewer.
- Hidden phone and birthday data is never sent to the client: values are
  `null` and their compatibility flags are `false`.
- `POST /me/synced-contacts` accepts one explicitly consented contact with a
  required timezone-aware `consented_at` timestamp and only precomputed
  phone/email hashes. Each present hash is an unprefixed SHA-256 digest of
  exactly 64 ASCII hexadecimal characters; the API normalizes accepted uppercase
  hexadecimal to lowercase. It never accepts raw phone or raw email, `sha256:`
  prefixes, malformed hashes, or incorrect lengths, and no request body, name,
  hash, or birthday is logged.
- The backend does not read an iPhone address book and does not automatically
  upload device contacts. This PR makes no mobile provider switch; PR 32F will
  add the API facades while preserving Supabase fallback until cutover.
