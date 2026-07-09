import { config } from '../config';

export interface SynthesizeOptions {
  text: string;
  voice: string;
  /** 1.0 = normal, >1 faster, <1 slower. */
  rate: number;
}

/**
 * Calls the Piper HTTP server's POST /synthesize and returns WAV bytes.
 * Piper's `length_scale` is the inverse of speed (higher = slower), so we
 * map our `rate` (higher = faster) to 1/rate.
 */
export async function synthesize(opts: SynthesizeOptions): Promise<Buffer> {
  const lengthScale = opts.rate && opts.rate > 0 ? 1 / opts.rate : 1;
  // Piper's bundled http_server registers synthesis at POST / (root), not /synthesize.
  const res = await fetch(config.PIPER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: opts.text,
      voice: opts.voice || config.DEFAULT_VOICE,
      length_scale: lengthScale,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`piper synthesize failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

/** Quick reachability check for the piper service (used by /healthz). */
export async function piperHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${config.PIPER_URL}/voices`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
