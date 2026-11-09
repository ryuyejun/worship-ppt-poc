import type { ApiResponse } from './types';

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<{ data: T; headers: Headers }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Local-Token': window.LOCAL_ACCESS_TOKEN ?? '',
    },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!response.ok) {
    let message = '요청을 처리하지 못했습니다.';
    try {
      const payload = (await response.json()) as ApiResponse<unknown>;
      message = payload.error || message;
    } catch {
      // The PPT endpoint returns a file when successful, so an error may be plain text.
    }
    throw new Error(message);
  }
  if (response.headers.get('content-type')?.includes('application/json')) {
    const payload = (await response.json()) as ApiResponse<T>;
    if (!payload.success) throw new Error(payload.error || '요청을 처리하지 못했습니다.');
    return { data: payload.data, headers: response.headers };
  }
  return { data: (await response.blob()) as T, headers: response.headers };
}
