export function debounce<F extends (...a: any[]) => void>(fn: F, ms: number): F {
  let t: NodeJS.Timeout | null = null;
  return ((...args: any[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as F;
}
