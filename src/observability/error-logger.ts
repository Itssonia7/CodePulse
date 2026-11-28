export interface ObservabilityLogEntry {
  level: "info" | "warn" | "error";
  message: string;
  context?: Record<string, string | number | boolean | null>;
  timestamp: string;
}

export class ErrorLogger {
  private readonly entries: ObservabilityLogEntry[] = [];

  log(
    level: ObservabilityLogEntry["level"],
    message: string,
    context?: Record<string, string | number | boolean | null>,
  ): ObservabilityLogEntry {
    const entry: ObservabilityLogEntry = {
      level,
      message,
      context,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(entry);
    return entry;
  }

  error(
    message: string,
    context?: Record<string, string | number | boolean | null>,
  ): ObservabilityLogEntry {
    return this.log("error", message, context);
  }

  getEntries(): readonly ObservabilityLogEntry[] {
    return this.entries;
  }
}

export const defaultErrorLogger = new ErrorLogger();

export interface AxiosLikeHeaders {
  Authorization?: string;
  [key: string]: string | undefined;
}

export interface AxiosLikeRequestConfig {
  url?: string;
  method?: string;
  headers?: AxiosLikeHeaders;
  data?: unknown;
  _retry?: boolean;
}

export interface AxiosLikeError<T = unknown> extends Error {
  config?: AxiosLikeRequestConfig;
  response?: {
    status?: number;
    data?: T;
  };
}

export interface AxiosLikeClient<TResponse = unknown> {
  (config: AxiosLikeRequestConfig): Promise<TResponse>;
  defaults?: {
    headers?: {
      common?: AxiosLikeHeaders;
    };
  };
  interceptors: {
    response: {
      use: (
        onFulfilled: (response: TResponse) => TResponse | Promise<TResponse>,
        onRejected: (error: AxiosLikeError) => Promise<TResponse>,
      ) => number;
    };
  };
}

export interface SupabaseSessionRefresher {
  refreshSession: () => Promise<string | null>;
}

export interface AuthRefreshInterceptorOptions<TResponse = unknown> {
  client: AxiosLikeClient<TResponse>;
  sessionRefresher: SupabaseSessionRefresher;
  logger?: ErrorLogger;
  onRefreshFailed?: (error: unknown) => void;
}

export function attachAuth401RefreshInterceptor<TResponse = unknown>({
  client,
  sessionRefresher,
  logger = defaultErrorLogger,
  onRefreshFailed,
}: AuthRefreshInterceptorOptions<TResponse>): number {
  let inflightRefreshPromise: Promise<string | null> | null = null;

  const runSingleFlightRefresh = async (): Promise<string | null> => {
    if (!inflightRefreshPromise) {
      inflightRefreshPromise = sessionRefresher
        .refreshSession()
        .finally(() => {
          inflightRefreshPromise = null;
        });
    }
    return inflightRefreshPromise;
  };

  return client.interceptors.response.use(
    (response) => response,
    async (error: AxiosLikeError): Promise<TResponse> => {
      const status = error.response?.status;
      const originalConfig = error.config;

      if (status !== 401 || !originalConfig || originalConfig._retry) {
        return Promise.reject(error);
      }

      originalConfig._retry = true;

      try {
        const refreshedAccessToken = await runSingleFlightRefresh();
        if (!refreshedAccessToken) {
          throw new Error("Supabase session refresh returned no access token");
        }

        const nextHeaders: AxiosLikeHeaders = {
          ...(originalConfig.headers ?? {}),
          Authorization: `Bearer ${refreshedAccessToken}`,
        };
        originalConfig.headers = nextHeaders;

        if (client.defaults?.headers?.common) {
          client.defaults.headers.common.Authorization = `Bearer ${refreshedAccessToken}`;
        }

        return await client(originalConfig);
      } catch (refreshError: unknown) {
        logger.error("Failed to refresh session after 401 response", {
          url: originalConfig.url ?? "unknown",
          status: 401,
        });
        onRefreshFailed?.(refreshError);
        return Promise.reject(error);
      }
    },
  );
}
