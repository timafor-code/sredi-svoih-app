export type AuthenticatedRequestResult<T> = {
  result: T;
  unauthenticated: boolean;
};

type RetryAfterUnauthenticatedArgs<T> = {
  accessToken: string | null;
  initial: AuthenticatedRequestResult<T>;
  onFinalUnauthenticated: () => void;
  refreshAccessToken: () => Promise<string | null>;
  request: (accessToken: string) => Promise<AuthenticatedRequestResult<T>>;
};

export async function retryAfterUnauthenticated<T>(
  args: RetryAfterUnauthenticatedArgs<T>,
): Promise<T> {
  if (!args.initial.unauthenticated || !args.accessToken) {
    return args.initial.result;
  }

  const refreshedAccessToken = await args.refreshAccessToken();
  if (!refreshedAccessToken) {
    return args.initial.result;
  }

  const retry = await args.request(refreshedAccessToken);
  if (retry.unauthenticated) {
    args.onFinalUnauthenticated();
  }
  return retry.result;
}

export class SingleFlightRefresh<T> {
  private inFlight: Promise<T> | null = null;

  run(factory: () => Promise<T>): Promise<T> {
    if (!this.inFlight) {
      this.inFlight = factory().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }
}
