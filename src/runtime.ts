import { spawnSync } from "node:child_process";

import {
  KittyStreamTranslator,
  type CellDimensions,
  type TranslationMode,
  type TranslatorStats,
} from "./kitty-stream.js";

const BRIDGE_SYMBOL = Symbol.for("kyaulabs.pi-images.bridge");
const LEGACY_BRIDGE_SYMBOL = Symbol.for("kyaulabs.pi-sixel.bridge");
const DEFAULT_CELL_DIMENSIONS: CellDimensions = { widthPx: 9, heightPx: 18 };
const CELL_QUERY_INTERVAL_MS = 2_000;

interface ActivationResult {
  active: boolean;
  reason: string;
  mode?: TranslationMode;
  clientTermfeatures?: string;
}

interface GlobalBridge {
  users: number;
  mode: TranslationMode;
  translator: KittyStreamTranslator;
  uninstall: () => void;
}

/** Activation result and release handle owned by one loaded extension instance. */
export interface BridgeHandle {
  active: boolean;
  reason: string;
  mode?: TranslationMode;
  stats?: TranslatorStats;
  release: () => void;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : undefined;
}

/** Parse `rows columns width-px height-px` and derive one cell's pixel size. */
export function parseTerminalSize(value: string): CellDimensions | undefined {
  const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/.exec(value.trim());
  if (!match) return undefined;
  const rows = Number.parseInt(match[1]!, 10);
  const columns = Number.parseInt(match[2]!, 10);
  const widthPx = Number.parseInt(match[3]!, 10);
  const heightPx = Number.parseInt(match[4]!, 10);
  if (rows < 1 || columns < 1 || widthPx < columns || heightPx < rows) return undefined;
  const cellWidth = Math.round(widthPx / columns);
  const cellHeight = Math.round(heightPx / rows);
  if (cellWidth < 1 || cellWidth > 100 || cellHeight < 1 || cellHeight > 200) return undefined;
  return { widthPx: cellWidth, heightPx: cellHeight };
}

function queryTerminalCellDimensions(): CellDimensions | undefined {
  const configuredWidth = parsePositiveInteger(
    process.env.PI_IMAGES_CELL_WIDTH ?? process.env.PI_SIXEL_CELL_WIDTH,
  );
  const configuredHeight = parsePositiveInteger(
    process.env.PI_IMAGES_CELL_HEIGHT ?? process.env.PI_SIXEL_CELL_HEIGHT,
  );
  if (configuredWidth && configuredHeight) {
    return { widthPx: configuredWidth, heightPx: configuredHeight };
  }

  const script = [
    "import fcntl, struct, termios",
    "with open('/dev/tty', 'rb', buffering=0) as tty:",
    " print(*struct.unpack('HHHH', fcntl.ioctl(tty, termios.TIOCGWINSZ, b'\\0' * 8)))",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 750,
  });
  return result.status === 0 ? parseTerminalSize(result.stdout) : undefined;
}

/** Create a cached terminal-cell probe for SIXEL sizing. */
export function createCellDimensionProvider(): () => CellDimensions {
  let cached = queryTerminalCellDimensions() ?? DEFAULT_CELL_DIMENSIONS;
  let queriedAt = Date.now();
  return () => {
    if (Date.now() - queriedAt >= CELL_QUERY_INTERVAL_MS) {
      cached = queryTerminalCellDimensions() ?? cached;
      queriedAt = Date.now();
    }
    return cached;
  };
}

function tmuxPassthroughEnabled(): boolean {
  const result = spawnSync("tmux", ["show-options", "-gv", "allow-passthrough"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 750,
  });
  return result.status === 0 && /^(?:on|all)$/.test(result.stdout.trim());
}

function detectActivation(): ActivationResult {
  const enabled = (process.env.PI_IMAGES ?? process.env.PI_SIXEL)?.toLowerCase();
  if (enabled === "0" || enabled === "off") {
    return { active: false, reason: "disabled by PI_IMAGES" };
  }
  if (!process.env.TMUX) return { active: false, reason: "not running in tmux" };
  if (!process.stdout.isTTY) return { active: false, reason: "stdout is not a terminal" };

  const requestedProtocol = process.env.PI_IMAGE_PROTOCOL?.toLowerCase();
  if (requestedProtocol === "none" || requestedProtocol === "0" || requestedProtocol === "iterm2") {
    return { active: false, reason: `PI_IMAGE_PROTOCOL=${requestedProtocol}` };
  }

  const result = spawnSync(
    "tmux",
    ["display-message", "-p", "#{sixel_support}|#{client_termfeatures}|#{client_termname}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 750 },
  );
  if (result.status !== 0) return { active: false, reason: "unable to query tmux" };
  const [compiledSupport, features = "", terminalName = "unknown"] = result.stdout.trim().split("|");
  const featureSet = new Set(features.split(","));
  const requestedMode = process.env.PI_IMAGES_MODE?.toLowerCase();
  const placeholderRequested = requestedMode === "kitty-placeholder" || requestedMode === "placeholder";
  const sixelRequested = requestedMode === "sixel" || enabled === "1" || enabled === "force";

  if (placeholderRequested || (!sixelRequested && terminalName.toLowerCase().includes("ghostty"))) {
    if (!tmuxPassthroughEnabled()) {
      return { active: false, reason: "tmux allow-passthrough is not enabled" };
    }
    return {
      active: true,
      mode: "kitty-placeholder",
      reason: `tmux client ${terminalName} supports Kitty Unicode placeholders`,
      clientTermfeatures: features,
    };
  }

  if (compiledSupport !== "1") return { active: false, reason: "tmux was built without SIXEL support" };
  if (!sixelRequested && !featureSet.has("sixel")) {
    return {
      active: false,
      reason: `${terminalName} is not marked with the tmux sixel feature`,
      clientTermfeatures: features,
    };
  }
  return {
    active: true,
    mode: "sixel",
    reason: sixelRequested ? "SIXEL mode forced by configuration" : `tmux client ${terminalName} supports SIXEL`,
    clientTermfeatures: features,
  };
}

function toBuffer(chunk: string | Uint8Array, encoding?: BufferEncoding): Buffer {
  if (typeof chunk === "string") return Buffer.from(chunk, encoding ?? "utf8");
  return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

function installBridge(mode: TranslationMode): GlobalBridge {
  const globals = globalThis as Record<symbol, unknown>;
  const legacy = globals[LEGACY_BRIDGE_SYMBOL] as Pick<GlobalBridge, "uninstall"> | undefined;
  legacy?.uninstall();

  const existing = globals[BRIDGE_SYMBOL] as GlobalBridge | undefined;
  if (existing?.mode === mode) {
    existing.users += 1;
    return existing;
  }
  existing?.uninstall();

  const maxColors = parsePositiveInteger(process.env.PI_IMAGES_COLORS ?? process.env.PI_SIXEL_COLORS);
  const translator = new KittyStreamTranslator({
    getCellDimensions: createCellDimensionProvider(),
    mode,
    maxColors,
  });
  const originalWrite = process.stdout.write;
  const writeBuffer = originalWrite as unknown as (
    this: NodeJS.WriteStream,
    chunk: Uint8Array,
    callback?: (error?: Error | null) => void,
  ) => boolean;

  const patchedWrite = function (
    this: NodeJS.WriteStream,
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    const output = translator.push(toBuffer(chunk, encoding));
    if (output.length > 0) return writeBuffer.call(this, output, done);
    if (done) queueMicrotask(() => done(null));
    return true;
  };

  process.stdout.write = patchedWrite as typeof process.stdout.write;
  const bridge: GlobalBridge = {
    users: 1,
    mode,
    translator,
    uninstall: () => {
      if (process.stdout.write === patchedWrite) process.stdout.write = originalWrite;
      translator.reset();
      if ((globalThis as Record<symbol, unknown>)[BRIDGE_SYMBOL] === bridge) {
        delete (globalThis as Record<symbol, unknown>)[BRIDGE_SYMBOL];
      }
    },
  };
  (globalThis as Record<symbol, unknown>)[BRIDGE_SYMBOL] = bridge;
  return bridge;
}

/**
 * Detect a safe tmux image mode and install the process-wide output bridge.
 * The caller must invoke `release` when its extension session shuts down.
 */
export function acquireBridge(): BridgeHandle {
  const activation = detectActivation();
  if (!activation.active) {
    return { active: false, reason: activation.reason, release: () => {} };
  }

  // Pi has no third-party image backend. Ask it for Kitty output, then convert
  // those terminal bytes into the mode selected for the attached tmux client.
  process.env.PI_IMAGE_PROTOCOL = "kitty";
  const bridge = installBridge(activation.mode ?? "sixel");
  let released = false;
  return {
    active: true,
    reason: activation.reason,
    mode: bridge.mode,
    stats: bridge.translator.stats,
    release: () => {
      if (released) return;
      released = true;
      bridge.users -= 1;
      if (bridge.users <= 0) bridge.uninstall();
    },
  };
}

/** Format activation details and live counters for display inside Pi. */
export function formatBridgeStatus(handle: BridgeHandle): string {
  if (!handle.active || !handle.stats) return `pi-images: inactive (${handle.reason})`;
  const stats = handle.stats;
  return [
    `pi-images: active (${handle.reason})`,
    `mode: ${handle.mode}`,
    `transmissions: ${stats.transmissions}`,
    `placements: ${stats.placements}`,
    `cache: ${stats.cacheHits} hits / ${stats.cacheMisses} misses`,
    `sources: ${stats.sourceImages}`,
    `render cache: ${stats.cachedRenders} entries / ${Math.round(stats.cachedRenderBytes / 1024)} KiB`,
    `conversion failures: ${stats.conversionFailures}`,
    `dropped input: ${stats.droppedBytes} bytes`,
  ].join("\n");
}
