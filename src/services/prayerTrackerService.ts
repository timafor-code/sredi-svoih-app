import { appCapabilities } from '@/config/appCapabilities';
import {
  listLocalPrayerActivity,
  recordLocalPrayerActivity,
} from '@/local-data/prayerRepository';
import type {
  LoadPrayerActivityParams,
  LocalPrayerActivityLog,
  PrayerActivityLog,
  PrayerTrackerActivity,
  RecordPrayerActivityInput,
} from '@/types/prayerTracker';

import {
  loadMyPrayerActivity as loadApiPrayerActivity,
  recordPrayerActivity as recordApiPrayerActivity,
} from './prayerTrackerApiService';

export interface PrayerTrackerProvider {
  loadActivity(
    params?: LoadPrayerActivityParams,
  ): Promise<PrayerTrackerActivity[]>;
  recordActivity(
    input: RecordPrayerActivityInput,
  ): Promise<PrayerTrackerActivity>;
}

type PrayerTrackerProviderSet = Readonly<{
  api: PrayerTrackerProvider;
  local: PrayerTrackerProvider;
}>;

type PrayerTrackerModeCapabilities = Readonly<{
  isAccountMode: boolean;
}>;

function mapLocalPrayerActivity(
  activity: LocalPrayerActivityLog,
): PrayerTrackerActivity {
  return {
    id: activity.localId,
    userId: null,
    activityType: activity.activityType,
    activityDate: activity.activityDate,
    startedAt: activity.startedAt,
    completedAt: activity.completedAt,
    timezone: activity.timezone,
    city: activity.city,
    hebrewDate: activity.hebrewDate,
    metadata: activity.metadata,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
  };
}

function mapApiPrayerActivity(
  activity: PrayerActivityLog,
): PrayerTrackerActivity {
  return {
    id: activity.id,
    userId: activity.userId,
    activityType: activity.activityType,
    activityDate: activity.activityDate,
    startedAt: activity.startedAt,
    completedAt: activity.completedAt,
    timezone: activity.timezone,
    city: activity.city,
    hebrewDate: activity.hebrewDate,
    metadata: activity.metadata,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
  };
}

const localPrayerTrackerProvider: PrayerTrackerProvider = {
  async loadActivity(params) {
    const items = await listLocalPrayerActivity(params);
    return items.map(mapLocalPrayerActivity);
  },

  async recordActivity(input) {
    const activity = await recordLocalPrayerActivity(input);
    return mapLocalPrayerActivity(activity);
  },
};

const apiPrayerTrackerProvider: PrayerTrackerProvider = {
  async loadActivity(params) {
    const items = await loadApiPrayerActivity(params);
    return items.map(mapApiPrayerActivity);
  },

  async recordActivity(input) {
    const activity = await recordApiPrayerActivity(input);
    return mapApiPrayerActivity(activity);
  },
};

function selectPrayerTrackerProvider(
  capabilities: PrayerTrackerModeCapabilities,
  providers: PrayerTrackerProviderSet,
): PrayerTrackerProvider {
  return capabilities.isAccountMode ? providers.api : providers.local;
}

const selectedPrayerTrackerProvider = selectPrayerTrackerProvider(
  appCapabilities,
  {
    api: apiPrayerTrackerProvider,
    local: localPrayerTrackerProvider,
  },
);

export async function loadMyPrayerActivity(
  params: LoadPrayerActivityParams = {},
): Promise<PrayerTrackerActivity[]> {
  return selectedPrayerTrackerProvider.loadActivity(params);
}

export async function recordPrayerActivity(
  input: RecordPrayerActivityInput,
): Promise<PrayerTrackerActivity> {
  return selectedPrayerTrackerProvider.recordActivity(input);
}
