# 🖼️ pi-images

[https://kyaulabs.com/](https://kyaulabs.com/)

[![Conventional Commits](https://img.shields.io/badge/conventional%20commits-1.0.0-fe5196?style=flat&logo=conventionalcommits)](https://www.conventionalcommits.org/en/v1.0.0/)
[![GitHub](https://img.shields.io/github/license/kyaulabs/pi-images?logo=gnu)](LICENSE)

A [Pi](https://github.com/earendil-works/pi-mono) extension that preserves inline images inside tmux. It translates Pi's Kitty graphics output into either Kitty Unicode placeholders or DEC SIXEL, depending on the outer terminal.

> [!WARNING]
> Pi does not currently expose an API for registering image protocols. This package uses a guarded terminal-output bridge and may require updates when Pi's TUI output changes.

## Why

Pi intentionally disables inline image detection inside tmux because a passed-through classic Kitty placement exists outside tmux's screen model. The terminal displays it, but tmux cannot reliably move or remove it when a pane scrolls, resizes, hides, or switches windows. The result is stale images at incorrect coordinates.

`pi-images` makes the placement visible to tmux:

```text
Pi Image component
      │ Kitty APC chunks
      ▼
pi-images streaming bridge
      ├─ Ghostty ── Kitty upload + Unicode placeholder cells
      └─ SIXEL terminal ── decode / resize / quantize / cache
                              │
                              ▼
                             tmux owns placement as pane content
```

### Ghostty mode

Ghostty 1.3.1 does not implement SIXEL. For Ghostty, the extension passes Kitty image uploads through tmux, creates virtual placements, and emits Kitty Unicode placeholder cells. The cells belong to tmux's text grid, so image placement follows clearing, scrolling, and redraws.

### SIXEL mode

For terminals that genuinely implement SIXEL, the extension decodes Pi's PNG or JPEG transmission and emits tmux-managed SIXEL. The encoder is implemented in TypeScript; `img2sixel` is not required.

## Requirements

- Node.js 22 or newer
- Pi 0.84.4 or newer
- tmux 3.4 or newer
- One of:
  - Ghostty with Kitty Unicode-placeholder support and tmux `allow-passthrough`
  - A SIXEL-capable outer terminal and tmux built with SIXEL support
- Python 3 only for automatic pixel sizing in SIXEL mode; fixed overrides are available

## Installation

### Local development checkout

```sh
pi install /home/kyau/projects/kyaulabs/pi-images
```

### GitHub

```sh
pi install git:github.com/kyaulabs/pi-images
```

Restart Pi after installation.

## tmux configuration

### Ghostty

Enable passthrough so image uploads and virtual-placement commands can reach Ghostty:

```tmux
set -g allow-passthrough on
set -as terminal-features ",xterm-ghostty:extkeys"
```

Do **not** add the `sixel` feature for Ghostty. Ghostty 1.3.1 rejects SIXEL DCS sequences.

### SIXEL terminals

Mark the actual outer terminal as SIXEL-capable, replacing the pattern as needed:

```tmux
set -as terminal-features ",xterm-sixel:sixel"
```

After changing terminal features, reload the configuration and detach/reattach the tmux client:

```sh
tmux source-file ~/.tmux.conf
tmux detach-client
# Run this from the outer terminal after detaching:
tmux attach
```

## Usage

The extension activates only for an interactive Pi process inside tmux. In automatic mode it chooses:

- `kitty-placeholder` for a Ghostty client when `allow-passthrough` is enabled
- `sixel` when tmux reports compiled SIXEL support and the client has the `sixel` feature
- no bridge when neither safe mode is available

Inspect activation and runtime statistics inside Pi:

```text
/images-status
```

`/sixel-status` remains as a compatibility alias.

Outside tmux, the extension remains inactive and Pi uses its normal image protocol detection.

## Configuration

| Variable | Meaning | Default |
| --- | --- | --- |
| `PI_IMAGES=0` | Disable the extension | unset |
| `PI_IMAGES_MODE=kitty-placeholder` | Force Kitty Unicode placeholders | automatic |
| `PI_IMAGES_MODE=sixel` | Force SIXEL output | automatic |
| `PI_IMAGES_COLORS` | SIXEL palette size, from 2 to 254 | `128` |
| `PI_IMAGES_CELL_WIDTH` | SIXEL terminal-cell width in pixels | detected |
| `PI_IMAGES_CELL_HEIGHT` | SIXEL terminal-cell height in pixels | detected |

Both cell-size overrides must be set together. Legacy `PI_SIXEL` and `PI_SIXEL_*` variables remain accepted for compatibility.

Explicit `PI_IMAGE_PROTOCOL=none`, `0`, or `iterm2` prevents activation. Otherwise the extension selects Pi's Kitty encoder internally and consumes its commands before they reach tmux.

## Supported image flow

The streaming bridge handles:

- Single and multi-chunk Kitty transmissions
- Kitty commands split across arbitrary `stdout.write()` boundaries
- Placement-only redraw commands
- PNG and JPEG payloads
- Source cropping for partially visible content
- Kitty image and placement deletion
- Cursor-safe placeholder grids
- Bounded SIXEL conversion caching

Malformed image commands are dropped rather than leaked into the terminal.

## Development

```sh
npm install
npm run hooks:install
npm run check
```

The tracked Git hooks require `gitleaks`, run the verification suite before commits, and reject non-Conventional Commit messages. GitHub Actions applies the same policy to pushed and pull-request commits.

The tests cover SIXEL encoding, Kitty chunk reassembly, arbitrary stream boundaries, virtual placeholder output, placement replay, deletion, and terminal pixel-size parsing.

## Limitations

- Kitty placeholder mode requires tmux passthrough for image-control commands, although tmux owns the visible placeholder cells.
- SIXEL uses a reduced palette and may be larger than the source PNG.
- Initial SIXEL conversion is synchronous; cached redraws avoid repeated work.
- The bridge limits target SIXEL images to 2.5 million pixels and bounds its cache.
- A future Pi release that adds a native extensible image backend may make this bridge unnecessary.

## Attribution

Kitty Unicode placeholder helpers are adapted from `pi-tmux-images` and `pi-sprite` under the MIT License. See [NOTICE](NOTICE).

## License

Copyright © KYAU Labs. Licensed under the [GNU Affero General Public License v3.0](LICENSE).
