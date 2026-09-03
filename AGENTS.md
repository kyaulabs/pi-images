# Repository guidance

## Scope

`pi-images` translates the Kitty graphics emitted by Pi into image output that tmux can track. Ghostty uses Kitty Unicode placeholders. Terminals that implement SIXEL may use SIXEL.

Limit the bridge to interactive tmux sessions. Fail closed: malformed, incomplete, oversized, or unsupported image commands must not leak payload bytes to the terminal.

## Development rules

- Use strict TypeScript.
- Prefer pure JavaScript runtime dependencies.
- Preserve arbitrary byte-boundary handling in `KittyStreamTranslator`.
- Wrap Kitty uploads and virtual-placement commands in tmux passthrough.
- Emit Kitty placeholder cells as normal pane text so tmux owns their positions.
- Do not advertise SIXEL for a terminal that does not implement it.
- Keep transmission, image, pixel, and cache limits explicit and tested.
- Keep `pi-images.tmux` compatible with TPM and valid under ShellCheck.
- Add a regression test for parser, cursor, cache, protocol, or activation changes.
- Update README setup and troubleshooting text when public behavior changes.

## Verification

Run:

```sh
npm run check
npm pack --dry-run
```

Protocol changes require a visual test in the affected terminal and tmux mode. Test clearing, scrolling, resizing, redraws, and window switching when placement behavior changes.

## Commits

Use Conventional Commits. Branch from `develop` and follow [CONTRIBUTING.md](CONTRIBUTING.md).
