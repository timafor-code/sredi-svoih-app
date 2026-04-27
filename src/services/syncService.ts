export const syncService = {
  syncContactsToServer: async (consent: boolean) => {
    if (!consent) return { synced: 0, reason: 'consent_required' };
    return { synced: 0, reason: 'mock_mode' };
  },
};
