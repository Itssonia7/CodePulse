import { describe, it, expect, vi } from "vitest";
import {
  attachAuth401RefreshInterceptor,
  type AxiosLikeClient,
  type AxiosLikeError,
  type AxiosLikeRequestConfig,
} from "./error-logger";

interface MockResponse {
  data: { ok: boolean; tokenUsed?: string };
}

function createMockAxiosClient(
  handler: (config: AxiosLikeRequestConfig) => Promise<MockResponse>,
): {
  client: AxiosLikeClient<MockResponse>;
  triggerRejected: (err: AxiosLikeError) => Promise<MockResponse>;
} {
  let rejectedFn!: (error: AxiosLikeError) => Promise<MockResponse>;

  const fn = vi.fn((config: AxiosLikeRequestConfig) => handler(config)) as unknown as AxiosLikeClient<MockResponse>;
  fn.defaults = { headers: { common: {} } };
  fn.interceptors = {
    response: {
      use: vi.fn((_onFulfilled, onRejected) => {
        rejectedFn = onRejected;
        return 1;
      }),
    },
  };

  return {
    client: fn,
    triggerRejected: (err) => rejectedFn(err),
  };
}

describe("HTTP 401 Axios Interceptor & Supabase Token Refresh (#6160)", () => {
  it("intercepts 401, refreshes Supabase session token, updates Authorization header, and replays request", async () => {
    const { client, triggerRejected } = createMockAxiosClient(async (cfg) => ({
      data: { ok: true, tokenUsed: cfg.headers?.Authorization },
    }));
    const refreshSession = vi.fn().mockResolvedValue("fresh-supabase-jwt");

    attachAuth401RefreshInterceptor({
      client,
      sessionRefresher: { refreshSession },
    });

    const originalConfig: AxiosLikeRequestConfig = {
      url: "/api/v1/submissions",
      method: "get",
      headers: { Authorization: "Bearer expired-jwt" },
    };
    const err401: AxiosLikeError = Object.assign(new Error("Unauthorized"), {
      config: originalConfig,
      response: { status: 401 },
    });

    const replayed = await triggerRejected(err401);

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(replayed.data.ok).toBe(true);
    expect(replayed.data.tokenUsed).toBe("Bearer fresh-supabase-jwt");
    expect(client).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/v1/submissions",
        _retry: true,
        headers: expect.objectContaining({
          Authorization: "Bearer fresh-supabase-jwt",
        }),
      }),
    );
  });

  it("deduplicates concurrent 401 refreshes and rejects when refresh fails", async () => {
    let resolveToken!: (token: string | null) => void;
    const refreshSession = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolveToken = resolve;
        }),
    );

    const { client, triggerRejected } = createMockAxiosClient(async () => ({
      data: { ok: true },
    }));

    attachAuth401RefreshInterceptor({
      client,
      sessionRefresher: { refreshSession },
    });

    const make401 = (url: string): AxiosLikeError =>
      Object.assign(new Error("Unauthorized"), {
        config: { url, method: "get" },
        response: { status: 401 },
      });

    const p1 = triggerRejected(make401("/api/a"));
    const p2 = triggerRejected(make401("/api/b"));

    resolveToken("shared-refreshed-token");
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(r1.data.ok).toBe(true);
    expect(r2.data.ok).toBe(true);

    // Failure case
    const failingRefresher = { refreshSession: vi.fn().mockResolvedValue(null) };
    const onRefreshFailed = vi.fn();
    const { client: failClient, triggerRejected: triggerFail } = createMockAxiosClient(
      async () => ({ data: { ok: true } }),
    );
    attachAuth401RefreshInterceptor({
      client: failClient,
      sessionRefresher: failingRefresher,
      onRefreshFailed,
    });

    await expect(triggerFail(make401("/api/c"))).rejects.toThrow("Unauthorized");
    expect(onRefreshFailed).toHaveBeenCalledTimes(1);
  });
});
