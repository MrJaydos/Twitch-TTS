# Twitch TTS

Self-hosted, multi-user **Text-to-Speech browser source** for Twitch streamers.

Each streamer logs in with Twitch, points the app at a channel, tunes their voice
and filters from a web dashboard, and drops a personal **Browser Source URL** into
OBS. The server reads chat, generates speech with [Piper](https://github.com/OHF-Voice/piper1-gpl)
(fully self-hosted — no per-word API costs), and streams the audio to the overlay.

- **TTS engine:** Piper, running in Docker. No cloud keys, no usage fees.
- **Trigger:** Twitch chat messages (all messages, or only a `!command` prefix).
- **Multi-user:** anyone can log in with Twitch and run their own overlay.
- **Deploy:** Docker Compose, built for Coolify auto-deploy from GitHub.

---

## How it works

```
Streamer → Dashboard (login with Twitch) → configures channel/voice/filters
        → copies their Browser Source URL
OBS Browser Source  ──ws──►  app
app reads chat anonymously (justinfan, no token needed)
   → applies the streamer's filters
   → Piper synthesizes a WAV  →  app streams a "play" event to the overlay
Overlay plays audio in order (+ optional on-screen captions)
```

The **app image bundles Piper** (it runs a Piper HTTP server on `127.0.0.1:5000`
inside the same container), so deployment is just:

| Component  | Role                                                                       |
| ---------- | -------------------------------------------------------------------------- |
| `app`      | Node/Fastify + bundled Piper: dashboard, overlay, API, WebSockets, chat reader, TTS |
| Postgres   | User accounts + settings. Use a managed/separate DB via `DATABASE_URL`.    |

Bundling Piper keeps everything in one container, which is the most reliable
setup on platforms (like Coolify) that deploy a single service per resource.

> **Why server-side audio?** OBS browser sources run an embedded Chromium that
> usually has **no** speech-synthesis voices, so the browser's `speechSynthesis`
> can't be relied on. The server generates the audio; the overlay only plays it.

---

## 1. Register a Twitch application

1. Go to <https://dev.twitch.tv/console/apps> → **Register Your Application**.
2. **OAuth Redirect URL** must be exactly:
   `https://twitchtts.alfi3.com/auth/twitch/callback`
   (for local testing: `http://localhost:3000/auth/twitch/callback`)
3. Category: *Website Integration*. Create it, then copy the **Client ID** and
   generate a **Client Secret**.

You can add more redirect URLs later (e.g. one for local dev and one for prod).

---

## 2. Deploy on Coolify (recommended)

Coolify deploys one service per resource, so run the app as a **Dockerfile app**
plus a **managed Postgres** — no multi-service compose needed.

1. Push this repo to GitHub.
2. **Create the database:** New Resource → **Database → PostgreSQL** (same
   Project/Server as the app). Start it, and copy its **internal** connection URL
   (looks like `postgresql://postgres:PW@internalhost:5432/postgres`).
3. **Create the app:** New Resource → **Application** from your repo. Build Pack:
   **Dockerfile** (root `Dockerfile`). Coolify installs a webhook so every push
   redeploys automatically.
4. Set a **Domain** for the app (Coolify's proxy terminates TLS), routing to
   port **3000**.
5. Add a **Persistent Storage** volume mounted at **`/data`** (holds Piper voices
   + the audio cache, so voices aren't re-downloaded on every deploy).
6. Add these **Environment Variables** (all required):

   | Variable               | Value                                                    |
   | ---------------------- | -------------------------------------------------------- |
   | `PUBLIC_URL`           | `https://twitchtts.alfi3.com` (no trailing slash)        |
   | `TWITCH_CLIENT_ID`     | from step 1                                               |
   | `TWITCH_CLIENT_SECRET` | from step 1                                               |
   | `SESSION_SECRET`       | long random string — `openssl rand -hex 32`              |
   | `DATABASE_URL`         | the managed Postgres internal URL from step 2            |

   Piper runs **inside** the container (`PIPER_URL` defaults to `127.0.0.1:5000`),
   so no separate service is needed. To change voices, set `DEFAULT_VOICE` /
   `PIPER_VOICES`.

7. Deploy. First boot downloads the Piper voices into `/data` (can take a minute).

> The bundled `ttsdb` service in `docker-compose.yaml` is only for local
> `docker compose up`; on Coolify you use the managed Postgres from step 2.

Open `https://twitchtts.alfi3.com` and log in with Twitch.

---

## 3. Run locally with Docker

```bash
cp .env.example .env      # then fill in TWITCH_* and SESSION_SECRET
docker compose up --build
```

Visit <http://localhost:3000>. For local login, set the Twitch redirect URL to
`http://localhost:3000/auth/twitch/callback` and `PUBLIC_URL=http://localhost:3000`.

---

## 4. Add the overlay to OBS

1. In the dashboard, copy your **Browser Source URL** (`…/overlay?token=…`).
2. OBS → **Sources → + → Browser**.
3. Paste the URL. Size doesn't matter (audio-only unless captions are on; a
   common choice is 1920×1080).
4. Tick **Control audio via OBS** so the TTS routes through your OBS audio mixer.
5. Click **Speak** on the dashboard to test — you should hear it in OBS.

> Keep the URL private. Anyone who has it can play audio through your overlay.
> Use **Regenerate** in the dashboard to invalidate the old URL.

---

## Settings reference

| Setting                | What it does                                                       |
| ---------------------- | ----------------------------------------------------------------- |
| Enabled                | Master on/off for reading chat.                                    |
| Twitch channel         | Which channel's chat to read (defaults to your own).              |
| Voice                  | Piper voice. The list comes from `PIPER_VOICES`.                  |
| Unique voices          | Give each chatter their own consistent voice from the pool.       |
| Let chatters pick       | Enable the `!voice` chat command (requires unique voices).        |
| Trigger                | Read every message, or only messages starting with a prefix.      |
| Prefix                 | The command prefix (e.g. `!tts`) when trigger = prefix.           |
| Who can trigger        | everyone / subscribers+ / VIPs+ / moderators only.                |
| Per-user cooldown      | Minimum seconds between messages **from the same chatter**.       |
| Speed / Volume         | Playback rate and overlay volume.                                 |
| Max message length     | Longer messages are truncated.                                    |
| Blocked words          | Skip the message, or censor the words with `***`.                 |
| Ignored users          | Never read these logins (useful for chat bots).                   |
| Read the username      | Prefix speech with “Name says: …”.                                |
| Skip links / emotes    | Strip URLs / emotes before speaking.                              |
| On-screen captions     | Show who said what as a caption on the overlay.                   |

Dashboard controls: **Speak** (test message), **Skip current**, **Clear queue**,
and a live **Activity** feed of what's being read.

---

## Adding more voices

Browse voices at <https://huggingface.co/rhasspy/piper-voices>. Add their names
(e.g. `en_US-hfc_female-medium`) to `PIPER_VOICES`, comma-separated, and redeploy.
The `piper` service downloads any that are missing on boot.

---

## Unique voices & the `!voice` command

Turn on **Give each chatter their own voice** in Settings and every chatter is
assigned a consistent voice from your `PIPER_VOICES` pool — the same person
always sounds the same. Assignments are stored per chatter, so they survive
restarts. The number of distinct voices is bounded by how many you list in
`PIPER_VOICES`.

With that on, **Let chatters pick with `!voice`** lets viewers choose their own:

| Command          | Effect                                             |
| ---------------- | -------------------------------------------------- |
| `!voice <name>`  | Set your voice (e.g. `!voice amy`).                |
| `!voice random`  | Get a random voice from the pool.                  |
| `!voice list`    | List the available voices.                         |
| `!voice help`    | Show usage.                                        |

A chatter's explicit choice is locked and won't be reassigned. Uncheck the
option to disable the command in your channel.

**Confirmation replies** require a bot account: set `TWITCH_BOT_USERNAME` and
`TWITCH_BOT_TOKEN` (a token with `chat:read` + `chat:edit`) on the server. Without
one, the chat reader stays anonymous and `!voice` still applies the chosen voice
— it just won't post a confirmation message.

---

## Verifying a deploy

- **Health:** `GET https://twitchtts.alfi3.com/healthz` → `{"ok":true,"piper":true}`.
  `piper:false` means the piper service isn't reachable/ready yet.
- **TTS path:** open the overlay URL in a normal browser tab (click once to allow
  audio), then hit **Speak** on the dashboard → you hear it.
- **Live chat:** type in the configured channel's chat → it's read aloud, and the
  message shows in the dashboard's Activity feed.
- **Filters:** flip to prefix mode / raise the role gate / add a blocked word and
  confirm messages are gated as expected.
- **Multi-user:** log in from a second Twitch account → separate token, separate
  channel, fully independent.

---

## Troubleshooting

- **`P1000: Authentication failed against database server`** — the bundled Postgres
  uses **trust auth** on the internal-only network, so passwords aren't checked and
  this shouldn't occur. If it does, an old Postgres volume is likely in play: bump the
  volume name in `docker-compose.yaml` (e.g. `pgdata3` → `pgdata4`) so it
  re-initializes, and remove any `POSTGRES_PASSWORD` / `DATABASE_URL` you set in the
  platform's env UI (they're not needed and can interfere).
- **`/healthz` shows `"piper": false`** — the piper service is still downloading
  voices on first boot (can take a minute) or hasn't started yet. Give it a moment.

## Local development (without Docker)

Requires Node 20+ and a reachable Postgres and Piper server.

```bash
npm install
npx prisma db push          # create tables (needs DATABASE_URL)
npm run dev                 # tsx watch on src/server.ts
```

Point `PIPER_URL` at a running Piper HTTP server and `DATABASE_URL` at Postgres.
The dashboard and overlay are plain static files under `public/`, served by the
app — no separate frontend build step.

---

## Tech notes

- Chat is read **anonymously** over `wss://irc-ws.chat.twitch.tv` using a
  `justinfan` nick — no chat token or scopes required. Twitch OAuth is only used
  to identify the streamer at login.
- Audio is cached by content hash under `AUDIO_CACHE_DIR` and garbage-collected
  after `AUDIO_TTL_SECONDS`.
- One anonymous IRC connection serves all active channels (join/part as overlays
  connect and disconnect).

## License

MIT
