import { QueryClient, QueryFunction } from "@tanstack/react-query";

const DASHBOARD_AUTH_HEADER = "x-dashboard-auth-token";
export const DASHBOARD_AUTH_TOKEN_STORAGE_KEY = "bubbl-dashboard-auth-token";
const DASHBOARD_AUTH_FLAG_STORAGE_KEY = "bubbl-authed";
export const DASHBOARD_AUTH_CHANGED_EVENT = "bubbl-auth-changed";

function getDashboardAuthToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return sessionStorage.getItem(DASHBOARD_AUTH_TOKEN_STORAGE_KEY);
}

function withDashboardAuthHeader(headers: HeadersInit = {}): HeadersInit {
  const dashboardAuthToken = getDashboardAuthToken();
  if (!dashboardAuthToken) {
    return headers;
  }
  return {
    ...headers,
    [DASHBOARD_AUTH_HEADER]: dashboardAuthToken,
  };
}

async function throwIfResNotOk(res: Response) {
  if (res.status === 401 && typeof window !== "undefined") {
    sessionStorage.removeItem(DASHBOARD_AUTH_TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(DASHBOARD_AUTH_FLAG_STORAGE_KEY);
    window.dispatchEvent(new Event(DASHBOARD_AUTH_CHANGED_EVENT));
  }

  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: withDashboardAuthHeader(data ? { "Content-Type": "application/json" } : {}),
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      headers: withDashboardAuthHeader(),
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
