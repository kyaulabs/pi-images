#!/usr/bin/env bash

set -euo pipefail

# Kitty placeholder mode needs passthrough for uploads and virtual placements.
tmux set-option -gq allow-passthrough on
