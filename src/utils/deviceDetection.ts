/**
 * deviceDetection.ts
 * Reliable client-side device classification for desktop vs mobile devices.
 */

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;

  const ua =
    navigator.userAgent ||
    navigator.vendor ||
    (window as unknown as { opera?: string }).opera ||
    '';

  const isMobileUA =
    /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i.test(
      ua
    );

  const hasTouch =
    'ontouchstart' in window ||
    (navigator.maxTouchPoints != null && navigator.maxTouchPoints > 0);

  const isCoarsePointer =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;

  const isFinePointer =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
      : false;

  // Definite mobile user-agent match
  if (isMobileUA) return true;

  // Touch screen without high-precision mouse pointer
  if (hasTouch && !isFinePointer) return true;

  // Standard phone or tablet screen dimensions with touch
  if (hasTouch && window.innerWidth < 1024) return true;

  // Coarse touch interaction device
  if (isCoarsePointer && !isFinePointer) return true;

  return false;
}

export function isDesktopDevice(): boolean {
  if (typeof window === 'undefined') return true;
  return !isMobileDevice();
}
