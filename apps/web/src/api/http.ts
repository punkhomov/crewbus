export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(
      statusCode === 409
        ? "Диалог занят. Обновите данные."
        : statusCode === 401 || statusCode === 403
          ? "Проверьте API-ключ в настройках."
          : statusCode === 400
            ? "Проверьте введённые данные."
            : "Запрос не выполнен. Попробуйте ещё раз.",
    );
  }
}
export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new HttpError(response.status, body?.error?.code ?? "request_failed");
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}
