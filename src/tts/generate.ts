import { synthesize } from './piper-client';
import { audioKey, has, write } from './audio-store';

export interface GenerateOptions {
  text: string;
  voice: string;
  rate: number;
}

/**
 * Ensures audio for the given text exists in the cache and returns its id.
 * The caller builds the playable URL as `/audio/<id>.wav`.
 */
export async function generateAudio(opts: GenerateOptions): Promise<string> {
  const id = audioKey(opts);
  if (!(await has(id))) {
    const buf = await synthesize(opts);
    await write(id, buf);
  }
  return id;
}

export function audioUrl(id: string): string {
  return `/audio/${id}.wav`;
}
