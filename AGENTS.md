# Repository Guidance

## Scope

`pi-sixel` is a Pi extension that translates Kitty graphics commands emitted by Pi into SIXEL for tmux. Keep the bridge narrowly scoped to interactive tmux sessions and fail closed: malformed image commands must never leak raw payload bytes to the terminal.

## Development

- Use TypeScript with strict type checking.
- Keep runtime dependencies pure JavaScript when practical.
- Preserve arbitrary stream-boundary handling in `KittyStreamTranslator`.
- Bound image dimensions, transmission sizes, and caches.
- Add regression tests for parser, cursor, cache, or protocol changes.
- Run `npm run check` before submitting changes.

## Commits

Use Conventional Commits and branch from `develop` according to `CONTRIBUTING.md`.
