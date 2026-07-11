# Deploy workflow

This repo auto-deploys via Coolify on push to `main` — a push to `main` is a production deploy, not just a save point.

- After making code changes the user has asked for and verifying they build/typecheck, commit and push to `main` automatically. Don't stop to ask "should I push?" for routine changes — the user has pre-authorized this.
- Push only to `main`. Don't create or push to feature branches for this work — commits go straight to `main` so they deploy.
- Still use normal judgment about the change itself before committing (correctness, safety), and still avoid staging unrelated/incidental files (e.g. a `package-lock.json` that only appeared because of a local `npm install`, stray build output, etc.).
- Genuinely destructive or hard-to-reverse git operations (force-push, `reset --hard`, rewriting published history) still require explicit confirmation — this pre-authorization only covers normal "commit + push to main" for finished work.
