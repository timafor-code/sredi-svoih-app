/**
 * Returns a backend-trusted canonical public-web registration target.
 *
 * The current anonymous mobile event contract does not expose that target.
 * `registrationUrl` is an event-managed external-link field and must not be
 * reused here. Keep this adapter fail-closed until the API adds a dedicated
 * anonymous canonical URL contract.
 */
export async function getPublicWebEventRegistrationTarget(
  _eventId: string,
): Promise<string | null> {
  return null;
}
