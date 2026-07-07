import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().positive().default(3000),

  TWITCH_CLIENT_ID: z.string().min(1, 'TWITCH_CLIENT_ID is required'),
  TWITCH_CLIENT_SECRET: z.string().min(1, 'TWITCH_CLIENT_SECRET is required'),
  SESSION_SECRET: z
    .string()
    .min(16, 'SESSION_SECRET must be at least 16 characters'),

  DATABASE_URL: z.string().min(1),

  PIPER_URL: z.string().url().default('http://127.0.0.1:5000'),
  DEFAULT_VOICE: z.string().default('en_US-amy-medium'),
  PIPER_VOICES: z.string().default('en_US-amy-medium'),

  AUDIO_CACHE_DIR: z.string().default('/data/audio-cache'),
  AUDIO_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  NODE_ENV: z.string().default('development'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  /** Cookie is only marked Secure when serving over https. */
  cookieSecure: env.PUBLIC_URL.startsWith('https://'),
  oauthRedirectPath: '/auth/twitch/callback',
  get oauthRedirectUrl(): string {
    return `${env.PUBLIC_URL}${'/auth/twitch/callback'}`;
  },
  /** Configured voices as a clean list. */
  get voiceList(): string[] {
    return env.PIPER_VOICES.split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  },
};

export type AppConfig = typeof config;
