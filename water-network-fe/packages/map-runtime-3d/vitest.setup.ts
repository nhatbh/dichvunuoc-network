// jsdom has no 2D canvas: give the icon atlas a permissive no-op context so it can build.
const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? undefined : () => ({})), set: () => true }) as unknown as CanvasRenderingContext2D;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(HTMLCanvasElement.prototype as any).getContext = () => ctx;
