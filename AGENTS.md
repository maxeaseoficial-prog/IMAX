# IMx agent guide

IMx is a local Electron desktop cockpit for coordinating multiple Codex agents.

## Product rules

- Keep the app local-first.
- The user's existing Codex CLI login is reused; do not add API-key requirements for the MVP.
- Do not enable unrestricted permission bypass by default.
- Prefer isolated Git worktrees for parallel squad execution.
- The user's checked-out branch must remain untouched during a squad mission.
- Manual terminals may be opened independently from the PILOTO workflow.
- Keep terminal output visible and stream it live.
- The visual identity is dark + electric blue/cyan. Do not copy Overclock branding.

## Architecture

- Electron main process owns PTYs, Codex processes, Git worktrees, mission state and persistence.
- Preload exposes a narrow IPC API.
- React/Vite renderer owns only UI state and terminal rendering.
- xterm.js renders terminal panes.
- node-pty provides real local PTYs.
- Squad planning uses local `codex exec`; mission agents run in parallel.

## UI reference sources

For site and interface tasks, use the guidelines in `electron/ui-reference-guidelines.cjs`.
The preferred sources are https://reactbits.dev/, https://21st.dev/ and https://uiverse.io/.
Inspect available source code, adapt it to the project's stack and branding, and verify each component's license and dependencies. If browsing is unavailable, disclose it and implement an original alternative. Do not claim extraction without accessing the source. User instructions take precedence.


## Website art direction

For website, landing-page, redesign and web UI tasks, use `electron/web-design-guidelines.cjs`. The original reference is `docs/web-design-master.md`. Brand, audience and commercial clarity precede components; do not impose the IMx cockpit palette on customer sites. Preserve existing content and authorized scope. Report visual checks actually performed and remaining limitations. Backend-only tasks do not require visual redesign.
