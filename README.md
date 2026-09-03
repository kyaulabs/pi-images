# 🖼️ pi-sixel

[https://kyaulabs.com/](https://kyaulabs.com/)

[![Conventional Commits](https://img.shields.io/badge/conventional%20commits-1.0.0-fe5196?style=flat&logo=conventionalcommits)](https://www.conventionalcommits.org/en/v1.0.0/)
[![GitHub](https://img.shields.io/github/license/kyaulabs/pi-sixel?logo=gnu)](LICENSE)

A [Pi](https://github.com/earendil-works/pi-mono) extension that translates Pi's Kitty image output into DEC SIXEL so tmux can own, redraw, scroll, and clear inline images correctly.

> [!WARNING]
> Pi does not currently expose an API for registering image protocols. This package uses a guarded terminal-output bridge and may require updates when Pi's TUI output changes.

## Why

Pi intentionally disables inline image detection inside tmux because a passed-through Kitty placement exists outside tmux's screen model. The outer terminal displays it, but tmux cannot move or remove it when a pane scrolls, resizes, hides, or switches windows. The result is stale images and placements accumulating at incorrect coordinates.

`pi-sixel` lets Pi create its normal chunked PNG transmission, consumes that transmission before tmux sees it, and writes SIXEL in its place:

```text
Pi Image component
      │ Kitty APC chunks
      ▼
pi-sixel stream bridge ── decode / resize / quantize / cache
      │ SIXEL DCS
      ▼
     tmux ── owns the image as pane content
      │
      ▼
SIXEL-capable terminal
```

The encoder is implemented in TypeScript. No `img2sixel` executable is required.

## Requirements

- Node.js 22 or newer
- Pi 0.84.4 or newer
- tmux built with SIXEL support (`tmux display -p '#{sixel_support}'` prints `1`)
- A SIXEL-capable outer terminal, such as Ghostty
- Python 3 for automatic terminal pixel-size discovery on Unix; fixed environment overrides are available as a fallback

## Installation

### Local development checkout

```sh
pi install /home/kyau/projects/kyaulabs/pi-sixel
```

### GitHub

```sh
pi install git:github.com/kyaulabs/pi-sixel
```

Restart Pi after installation.

## tmux configuration

Mark the outer terminal as SIXEL-capable. For Ghostty:

```tmux
set -as terminal-features ",xterm-ghostty:sixel"
```

If the same entry already enables extended keys, combine the features:

```tmux
set -as terminal-features ",xterm-ghostty:extkeys:sixel"
```

Reload the configuration, then detach and reattach the client so tmux recalculates its client features:

```sh
tmux source-file ~/.tmux.conf
tmux detach-client
```

Verify the attached client:

```sh
tmux display -p '#{client_termfeatures}' | tr ',' '\n' | grep '^sixel$'
```

`allow-passthrough` is not required by this extension because tmux parses the generated SIXEL itself.

## Usage

The extension activates automatically only when all of the following are true:

- Pi is interactive and stdout is a terminal.
- Pi is running inside tmux.
- tmux reports compiled SIXEL support.
- The attached client has the `sixel` terminal feature.
- Image output has not been explicitly disabled.

Use the command below inside Pi to inspect activation and cache statistics:

```text
/sixel-status
```

Outside tmux, the extension remains inactive and Pi uses its normal image protocol detection.

## Configuration

Environment variables are optional:

| Variable | Meaning | Default |
| --- | --- | --- |
| `PI_SIXEL=0` | Disable the extension | unset |
| `PI_SIXEL=1` | Bypass tmux feature detection | unset |
| `PI_SIXEL_COLORS` | Maximum generated palette size, from 2 to 254 | `128` |
| `PI_SIXEL_CELL_WIDTH` | Override terminal cell width in pixels | detected |
| `PI_SIXEL_CELL_HEIGHT` | Override terminal cell height in pixels | detected |

Both cell-size overrides must be set together. Automatic detection reads the pseudo-terminal's `TIOCGWINSZ` pixel dimensions through Python.

Explicit `PI_IMAGE_PROTOCOL=none`, `0`, or `iterm2` prevents activation. Otherwise the extension selects Pi's Kitty encoder internally and consumes those Kitty commands before they reach tmux.

## Supported image flow

The bridge handles:

- Single and multi-chunk Kitty transmissions
- Kitty commands split across separate `stdout.write()` calls
- Placement-only redraw commands used by Pi's fullscreen TUI
- PNG and JPEG payloads
- Source cropping used when fullscreen content is partially visible
- Cursor preservation
- LRU caching of converted SIXEL data

Pi normally converts terminal-bound image content to PNG. Unsupported or malformed payloads are dropped rather than leaked into tmux.

## Development

```sh
npm install
npm run hooks:install
npm run check
```

The tracked Git hooks require `gitleaks`, run the verification suite before commits, and reject non-Conventional Commit messages. GitHub Actions applies the same commit-message policy to pushed and pull-request commits.

The test suite exercises the encoder, Kitty chunk reassembly, arbitrary stream boundaries, placement replay, deletion, and terminal pixel-size parsing.

## Limitations

- SIXEL uses a reduced palette and can be larger than the original PNG.
- Initial conversion is synchronous because Pi's component rendering and terminal write path are synchronous. Cached redraws avoid repeating the work.
- The bridge limits target images to 2.5 million pixels and bounds its render cache.
- Terminal cell-size auto-detection currently targets Unix-like systems with Python 3.
- A future Pi release that changes Kitty output or adds native SIXEL support may require this bridge to change or become unnecessary.

## License

Copyright © KYAU Labs. Licensed under the [GNU Affero General Public License v3.0](LICENSE).
