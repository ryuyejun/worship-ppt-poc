import type { ApiResponse } from './types';
import type { PresentationInput } from './presentation';

export const cloudflareMode = import.meta.env.VITE_BACKEND !== 'legacy';

export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<{ data: T; headers: Headers }> {
  if (cloudflareMode && (path === '/ppt/preview' || path === '/ppt/batch')) {
    const { collectSlides, makePresentation, renderSlide } = await import('./presentation');
    const previewInput = body as { presentation: PresentationInput; slideIndex: number };
    const input = path === '/ppt/preview' ? previewInput.presentation : body as PresentationInput;
    const slides = await collectSlides(input, signal);
    if (signal?.aborted) throw new DOMException('요청이 취소되었습니다.', 'AbortError');
    if (path === '/ppt/batch') return { data: await makePresentation(slides, input.style, input.slideSize) as T, headers: new Headers() };
    const slideIndex = Math.max(0, Math.min(previewInput.slideIndex, slides.length - 1));
    const imageBase64 = await renderSlide(slides[slideIndex], input.style, 1280, input.slideSize);
    return { data: { imageBase64, slideIndex, slideCount: slides.length } as T, headers: new Headers() };
  }
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
