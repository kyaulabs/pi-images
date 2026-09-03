# pi-images

`pi-images` keeps Pi's inline images aligned with tmux pane content. It translates the Kitty graphics commands emitted by Pi into one of two formats that tmux can track:

- Kitty Unicode placeholders for Ghostty
- DEC SIXEL for terminals that implement SIXEL

Pi and tmux do not need source patches.

[![Conventional Commits](https://img.shields.io/badge/conventional%20commits-1.0.0-fe5196?style=flat&logo=conventionalcommits)](https://www.conventionalcommits.org/en/v1.0.0/)
[![GitHub license](https://img.shields.io/github/license/kyaulabs/pi-images?logo=gnu)](LICENSE)

> [!IMPORTANT]
> Pi does not expose an API for third-party image protocols. While active, this extension wraps `process.stdout.write` and translates complete Kitty APC sequences before tmux receives them. Changes to Pi's terminal output may require a corresponding update here.

## Why this exists

Pi disables automatic inline-image detection inside tmux. A classic Kitty placement sent through tmux belongs to the outer terminal, not tmux's screen model. tmux cannot move or remove that placement when the pane scrolls, clears, resizes, or leaves the active window. The image then remains at a stale screen position.

`pi-images` keeps the visible placement in tmux's model:

```text
Pi image component
      │ Kitty APC chunks
      ▼
pi-images byte-stream parser
      ├── Ghostty: Kitty upload + virtual placement + Unicode cells
      └── SIXEL terminal: decode + resize + quantize + SIXEL DCS
                                      │
                                      ▼
                           tmux tracks pane placement
```

The parser retains incomplete Kitty commands across arbitrary `stdout.write()` boundaries. It does not use a regular expression over individual writes.

## Output modes

| Mode | Selection | Behavior |
| --- | --- | --- |
| `kitty-placeholder` | Automatic for a Ghostty tmux client | Passes image data and virtual-placement commands through tmux, then writes Unicode placeholder cells into the pane grid. |
| `sixel` | Automatic when tmux and its client advertise SIXEL | Decodes PNG or JPEG data, sizes it to the requested cells, and writes a tmux-managed SIXEL image. |
| inactive | No safe mode is available | Leaves Pi's normal capability handling unchanged. |

Ghostty 1.3.1 rejects SIXEL DCS input. Do not mark that version as SIXEL-capable. Its Kitty Unicode-placeholder implementation works through tmux when passthrough is enabled.

The SIXEL encoder is written in TypeScript. `img2sixel` is not required.

## Requirements

- Node.js 22 or newer
- Pi 0.84.4 or newer
- tmux 3.4 or newer
- A compatible outer terminal:
  - Ghostty with Kitty Unicode-placeholder support, or
  - a terminal that implements SIXEL
- Python 3 for automatic pixel-size detection in SIXEL mode

Python is not used in Kitty-placeholder mode. If Python is unavailable in SIXEL mode, configure fixed cell dimensions or accept the `9x18` pixel fallback.

## Install

From npm:

```sh
pi install npm:@kyaulabs/pi-images
```

From GitHub:

```sh
pi install git:github.com/kyaulabs/pi-images
```

From a local checkout:

```sh
pi install /path/to/pi-images
```

Restart Pi after installation. Installing the package changes Pi's package settings; it does not patch Pi's installed files.

### Install the tmux setup with TPM

The repository is also a [Tmux Plugin Manager](https://github.com/tmux-plugins/tpm) plugin. TPM clones the repository and runs `pi-images.tmux`, which enables `allow-passthrough`. TPM configures tmux only; install the Pi package separately.

Add the plugin before TPM's initialization line in `~/.tmux.conf`:

```tmux
set -g @plugin 'kyaulabs/pi-images'

# Keep this as the final plugin line.
run '~/.tmux/plugins/tpm/tpm'
```

Reload tmux, then press `Prefix` + <kbd>I</kbd> to install the plugin:

```sh
tmux source-file ~/.tmux.conf
```

Install the extension through Pi's package manager:

```sh
pi install npm:@kyaulabs/pi-images
```

To make Pi load TPM's checkout instead, install its two runtime dependencies first:

```sh
plugin_root="${TMUX_PLUGIN_MANAGER_PATH:-$HOME/.tmux/plugins}/pi-images"
npm --prefix "$plugin_root" install --omit=dev --legacy-peer-deps --ignore-scripts
pi install "$plugin_root"
```

Run the Pi installation once for each separate `PI_CODING_AGENT_DIR` profile that should load the extension.

After `Prefix` + <kbd>U</kbd> updates a checkout loaded directly by Pi, rerun the dependency command and use `/reload` or restart Pi.

## Configure tmux

### Ghostty

Enable passthrough so Kitty uploads and virtual-placement commands reach Ghostty. The TPM plugin sets `allow-passthrough`; a manual installation needs both lines below.

```tmux
set -g allow-passthrough on
set -as terminal-features ",xterm-ghostty:extkeys"
```

Do not add `sixel` to the Ghostty feature entry unless the installed Ghostty build implements SIXEL.

Reload the configuration:

```sh
tmux source-file ~/.tmux.conf
```

`allow-passthrough` applies immediately. If you change `terminal-features`, detach and reattach the client so tmux rebuilds the feature list:

```sh
tmux detach-client
# Run this from the outer terminal after detaching.
tmux attach
```

### SIXEL terminals

Add the `sixel` feature for the real outer-terminal name. Replace `xterm-sixel` with the value reported by `#{client_termname}`:

```tmux
set -as terminal-features ",xterm-sixel:sixel"
```

Check tmux and client support:

```sh
tmux display-message -p 'server=#{sixel_support} terminal=#{client_termname} features=#{client_termfeatures}'
```

The server value must be `1`, and the feature list must contain `sixel`.

## Verify operation

Inside Pi, run:

```text
/images-status
```

A working Ghostty session reports output similar to:

```text
pi-images: active (tmux client xterm-ghostty supports Kitty Unicode placeholders)
mode: kitty-placeholder
```

`/sixel-status` is a compatibility alias for `/images-status`.

Display an image, then run `/images-status` again. `transmissions` should increase. SIXEL mode also updates conversion-cache counters. Placeholder mode does not use the SIXEL render cache, so its cache counters remain zero.

Test image behavior by scrolling the pane, clearing content, resizing the client, and switching tmux windows. The placement should move or disappear with its pane cells.

## Activation rules

Automatic activation requires all of these conditions:

1. Pi is running interactively with a TTY on stdout.
2. Pi is running inside tmux.
3. `PI_IMAGE_PROTOCOL` is not `none`, `0`, or `iterm2`.
4. The detected output mode passes its capability check.

For Ghostty, `allow-passthrough` must be `on` or `all`. For SIXEL, tmux must have SIXEL support and the client must advertise the `sixel` feature.

Outside tmux, the bridge remains inactive and Pi uses its normal image detection.

## Configuration

| Variable | Accepted value | Effect |
| --- | --- | --- |
| `PI_IMAGES` | `0` or `off` | Disables the bridge. |
| `PI_IMAGES_MODE` | `kitty-placeholder` or `placeholder` | Forces placeholder mode; tmux passthrough must be enabled. |
| `PI_IMAGES_MODE` | `sixel` | Forces SIXEL mode; tmux must be built with SIXEL support. This bypasses the client-feature check. |
| `PI_IMAGES_COLORS` | Integer from 2 to 254 | Sets the maximum SIXEL palette size. The default is `128`. |
| `PI_IMAGES_CELL_WIDTH` | Positive integer | Sets the SIXEL cell width in pixels. |
| `PI_IMAGES_CELL_HEIGHT` | Positive integer | Sets the SIXEL cell height in pixels. |

Set both cell-size variables together. If either value is missing or invalid, the extension uses automatic detection.

The legacy `PI_SIXEL`, `PI_SIXEL_COLORS`, `PI_SIXEL_CELL_WIDTH`, and `PI_SIXEL_CELL_HEIGHT` names remain accepted for compatibility.

## Protocol and resource limits

The bridge supports:

- single-command and chunked Kitty transmissions;
- terminal writes split at any byte boundary;
- placement-only redraws;
- source rectangles used for partially visible images;
- image and placement deletion commands;
- PNG and JPEG decoding in SIXEL mode; and
- bounded source and SIXEL render caches.

A Kitty transmission may contain up to 64 MiB of base64 text. SIXEL output is limited to 2.5 million target pixels. The source cache retains at most 64 images. The SIXEL render cache retains at most 96 entries or 96 MiB.

Malformed, oversized, or unsupported image commands are removed instead of being written as raw base64 text.

## Troubleshooting

### The status command reports `inactive`

Read the reason shown by `/images-status`. Common causes are a non-tmux session, redirected stdout, disabled image output, missing Ghostty passthrough, or a SIXEL client without the `sixel` feature.

### `transmissions` increases but no image appears

Confirm the selected mode first. For Ghostty, the mode must be `kitty-placeholder`; Ghostty 1.3.1 discards SIXEL even if tmux was configured to advertise it. For another terminal, verify that it renders a known SIXEL file outside tmux before enabling the tmux feature.

### Raw base64 appears in the pane

Stop the session and report a bug with the Pi version, terminal version, `/images-status` output, and reproduction steps. The parser is designed to buffer fragmented commands, so raw payload text indicates an unhandled command shape or regression.

### Images have the wrong SIXEL size

Set `PI_IMAGES_CELL_WIDTH` and `PI_IMAGES_CELL_HEIGHT` to the terminal's cell size in pixels. These options affect only SIXEL conversion.

## Data handling

The bridge changes terminal rendering only. It does not add, remove, or alter image content in the conversation sent to the model.

Kitty-placeholder mode sends the encoded image through tmux passthrough to the outer terminal. SIXEL mode decodes the image in the Pi process and writes the converted bytes through tmux. Terminal logs or capture tools may retain those bytes. Do not display sensitive images in an untrusted terminal session.

## Development

Install dependencies and activate the tracked hooks:

```sh
npm install
npm run hooks:install
npm run check
npm pack --dry-run
```

The pre-commit hook requires [`gitleaks`](https://github.com/gitleaks/gitleaks). It scans the checkout and runs the TypeScript and test checks. The commit-message hook runs the project-local Commitlint binary. CI repeats package checks and commit-message validation. `shellcheck pi-images.tmux` verifies the TPM entry point.

The test suite covers SIXEL encoding, Kitty chunk reassembly, byte-level stream boundaries, virtual placements, deletion, cache behavior, and terminal-size parsing. Protocol changes also require a visual test in the affected terminal and tmux combination.

## Limitations

- Kitty-placeholder mode still needs passthrough for control commands. tmux owns the visible Unicode cells, not the uploaded image data.
- Forced SIXEL mode cannot prove that the outer terminal implements SIXEL.
- SIXEL reduces the palette and may write more bytes than the source PNG.
- Initial SIXEL conversion is synchronous because Pi's terminal write path is synchronous.
- The bridge depends on Pi's current Kitty output format and `process.stdout.write` behavior.

## Attribution

The Kitty Unicode-placeholder helpers are adapted from `pi-tmux-images` and `pi-sprite` under the MIT License. See [NOTICE](NOTICE).

## License

Copyright © KYAU Labs. Licensed under the [GNU Affero General Public License v3.0](LICENSE).
