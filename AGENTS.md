# Repository Guidance

## Scope

`pi-images` is a Pi extension that translates Kitty graphics emitted by Pi into tmux-safe image output. Ghostty uses Kitty Unicode placeholders; genuinely SIXEL-capable terminals use SIXEL. Keep the bridge limited to interactive tmux sessions and fail closed: malformed image commands must never leak raw payload bytes to the terminal.

## Development

- Use TypeScript with strict type checking.
- Keep runtime dependencies pure JavaScript when practical.
- Preserve arbitrary stream-boundary handling in `KittyStreamTranslator`.
- Keep Kitty upload commands wrapped in tmux passthrough while emitting placeholder cells as normal terminal text.
- Do not advertise SIXEL for a terminal that does not implement it.
- Bound image dimensions, transmission sizes, and caches.
- Add regression tests for parser, cursor, cache, or protocol changes.
- Run `npm run check` before submitting changes.

## Commits

Use Conventional Commits and branch from `develop` according to `CONTRIBUTING.md`.
