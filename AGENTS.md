# AGENTS.md

## Cursor Cloud specific instructions

- Cloud agents should rely on the repository environment config at `.cursor/environment.json`.
- Dependency bootstrap for this repo is handled by the environment `install` command, which runs `npm ci`.
- Use `npm run build` as the default full validation command (client + server TypeScript compile + Vite build).
- Do not commit generated build outputs (`dist/`, `dist-server/`) or local runtime artifacts.
