# Admin registrations

Production page: `apps/admin/src/pages/RegistrationsPage.tsx`.

The admin registrations workspace uses the regular authenticated Supabase client. Admin reads and writes stay behind RPC/RLS policies; the browser code must not use privileged server keys, Supabase Admin API, server-only database connection strings, or direct access to `auth.users`.

## Current architecture

- `RegistrationsPage.tsx` owns page state, loading, filtering, pagination, Excel export, toasts, occurrence selection, and registration status actions.
- `apps/admin/src/components/registrations/RegistrationEventsPanel.tsx` renders the events list and event search.
- `RegistrationCapacityBucketsOverview.tsx` renders capacity totals, option stats, and capacity bucket rows from existing capacity RPC data.
- `RegistrationsTable.tsx` renders the registrations table. A row click opens the participant detail modal; row action buttons keep their own click handling.
- `RegistrationDetailPanel.tsx` renders participant profile, contacts, event/session data, selected options, guests/comment, payment data, history, and status controls. It is now used inside the modal instead of a permanent right-side panel.

## v15 reference

The UX reference prototype is committed at:

`docs/prototype/registrations-improved-seating-v15.html`

This file is a reference document only. Production code should not copy the prototype's full HTML, CSS, JavaScript, seating editor, drag-and-drop, table templates, persistence, or mock data.

## This PR

- Changed the registrations workspace from a 3-column layout to a 2-column layout: events on the left, selected event workspace in the main column.
- Moved registration details into an accessible modal opened from the registrations table.
- Added a safe "Схема рассадки" placeholder button to capacity bucket rows.
- Kept the seating editor out of production scope.

## Next seating work

The seating editor, seating data types, backend/RPC/RLS changes, canvas, drag-and-drop, table templates, and save flow should be implemented in separate follow-up PRs.
