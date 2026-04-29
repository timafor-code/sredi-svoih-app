export type PrayerActivityType =
  | 'shacharit'
  | 'mincha'
  | 'maariv'
  | 'shema_morning'
  | 'shema_evening'
  | 'omer_count';

export type HebrewDatePayload = Record<string, unknown>;

export type PrayerActivityMetadata = Record<string, unknown>;

export interface PrayerActivityLog {
  id: string;
  userId: string;
  activityType: PrayerActivityType;
  activityDate: string;
  startedAt: string | null;
  completedAt: string | null;
  timezone: string;
  city: string | null;
  hebrewDate: HebrewDatePayload;
  metadata: PrayerActivityMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface RecordPrayerActivityInput {
  activityType: PrayerActivityType;
  activityDate?: string;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  timezone?: string;
  city?: string | null;
  hebrewDate?: HebrewDatePayload;
  metadata?: PrayerActivityMetadata;
}

export interface LoadPrayerActivityParams {
  limit?: number;
  fromDate?: string;
  toDate?: string;
}
