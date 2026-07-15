export type AppAuthMethod = 'email' | 'google' | 'apple' | 'unknown';

export type AppAuthUser = {
  id: string;
  email: string | null;
  phone: string | null;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  authMethod: AppAuthMethod;
  createdAt: string;
  updatedAt: string | null;
};

export type AppAuthSession = {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  tokenType: string;
  user: AppAuthUser;
};
