import { createHash } from "node:crypto";

import { decodeImage } from "./images.js";
import { encodeSixel, normalizeCrop, resizeToFit, type CropRect, type RgbaImage } from "./sixel.js";

const KITTY_PREFIX = Buffer.from("\x1b_G", "ascii");
const STRING_TERMINATOR = Buffer.from("\x1b\\", "ascii");
const CURSOR_SAVE = Buffer.from("\x1b7", "ascii");
const CURSOR_RESTORE = Buffer.from("\x1b8", "ascii");
const MAX_BASE64_BYTES = 64 * 1024 * 1024;
const MAX_TARGET_PIXELS = 2_500_000;
const MAX_CACHE_BYTES = 96 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 96;

export interface CellDimensions {
  widthPx: number;
  heightPx: number;
}

export interface TranslatorOptions {
  getCellDimensions: () => CellDimensions;
  maxColors?: number;
}

export interface TranslatorStats {
  transmissions: number;
  placements: number;
  cacheHits: number;
  cacheMisses: number;
  conversionFailures: number;
  droppedBytes: number;
  sourceImages: number;
  cachedRenders: number;
  cachedRenderBytes: number;
}

type Controls = Map<string, string>;

interface PendingTransmission {
  controls: Controls;
  payload: string[];
  bytes: number;
}

interface SourceImage {
  hash: string;
  encoded: Buffer;
  decoded?: RgbaImage;
}

interface CachedRender {
  data: Buffer;
  bytes: number;
}

function parseControls(value: string): Controls {
  const controls = new Map<string, string>();
  for (const item of value.split(",")) {
    if (!item) continue;
    const separator = item.indexOf("=");
    if (separator < 0) controls.set(item, "");
    else controls.set(item.slice(0, separator), item.slice(separator + 1));
  }
  return controls;
}

function integerControl(controls: Controls, key: string): number | undefined {
  const raw = controls.get(key);
  if (raw === undefined || !/^-?\d+$/.test(raw)) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function positiveControl(controls: Controls, key: string): number | undefined {
  const value = integerControl(controls, key);
  return value !== undefined && value > 0 ? value : undefined;
}

function findSafeSuffixStart(data: Buffer): number {
  if (data.length >= 2 && data[data.length - 2] === 0x1b && data[data.length - 1] === 0x5f) {
    return data.length - 2;
  }
  if (data[data.length - 1] === 0x1b) return data.length - 1;
  return data.length;
}

function sourceCrop(controls: Controls, image: RgbaImage): CropRect {
  return normalizeCrop(image, {
    x: integerControl(controls, "x"),
    y: integerControl(controls, "y"),
    width: positiveControl(controls, "w"),
    height: positiveControl(controls, "h"),
  });
}

/** Stateful Kitty APC-to-SIXEL translator. Input and output are raw terminal bytes. */
export class KittyStreamTranslator {
  readonly stats: TranslatorStats = {
    transmissions: 0,
    placements: 0,
    cacheHits: 0,
    cacheMisses: 0,
    conversionFailures: 0,
    droppedBytes: 0,
    sourceImages: 0,
    cachedRenders: 0,
    cachedRenderBytes: 0,
  };

  private pendingBytes = Buffer.alloc(0);
  private transmission?: PendingTransmission;
  private readonly sources = new Map<number, SourceImage>();
  private readonly renderCache = new Map<string, CachedRender>();
  private renderCacheBytes = 0;
  private readonly getCellDimensions: () => CellDimensions;
  private readonly maxColors: number;

  constructor(options: TranslatorOptions) {
    this.getCellDimensions = options.getCellDimensions;
    this.maxColors = Math.max(2, Math.min(254, Math.floor(options.maxColors ?? 128)));
  }

  push(chunk: Buffer): Buffer {
    if (chunk.length === 0) return Buffer.alloc(0);
    const data = this.pendingBytes.length > 0 ? Buffer.concat([this.pendingBytes, chunk]) : chunk;
    this.pendingBytes = Buffer.alloc(0);
    const output: Buffer[] = [];
    let cursor = 0;

    while (cursor < data.length) {
      const sequenceStart = data.indexOf(KITTY_PREFIX, cursor);
      if (sequenceStart < 0) {
        const safeEnd = findSafeSuffixStart(data);
        if (safeEnd > cursor) output.push(data.subarray(cursor, safeEnd));
        if (safeEnd < data.length) this.pendingBytes = Buffer.from(data.subarray(safeEnd));
        break;
      }

      if (sequenceStart > cursor) output.push(data.subarray(cursor, sequenceStart));
      const terminator = data.indexOf(STRING_TERMINATOR, sequenceStart + KITTY_PREFIX.length);
      if (terminator < 0) {
        this.pendingBytes = Buffer.from(data.subarray(sequenceStart));
        break;
      }

      const sequence = data.subarray(sequenceStart + KITTY_PREFIX.length, terminator);
      const replacement = this.translateSequence(sequence);
      if (replacement.length > 0) output.push(replacement);
      cursor = terminator + STRING_TERMINATOR.length;
    }

    return output.length === 0 ? Buffer.alloc(0) : Buffer.concat(output);
  }

  reset(): void {
    this.pendingBytes = Buffer.alloc(0);
    this.transmission = undefined;
    this.sources.clear();
    this.renderCache.clear();
    this.renderCacheBytes = 0;
    this.updateCacheStats();
  }

  private translateSequence(sequence: Buffer): Buffer {
    const separator = sequence.indexOf(0x3b);
    const controlsText = sequence.subarray(0, separator < 0 ? sequence.length : separator).toString("ascii");
    const payload = separator < 0 ? "" : sequence.subarray(separator + 1).toString("ascii");
    const controls = parseControls(controlsText);
    const action = controls.get("a");

    if (action === "T") return this.startTransmission(controls, payload);
    if (this.transmission && (controls.has("m") || payload.length > 0)) {
      return this.continueTransmission(controls, payload);
    }
    if (action === "p") {
      this.stats.placements += 1;
      return this.renderPlacement(controls);
    }
    if (action === "d") this.handleDeletion(controls);
    return Buffer.alloc(0);
  }

  private startTransmission(controls: Controls, payload: string): Buffer {
    this.transmission = {
      controls,
      payload: [payload],
      bytes: Buffer.byteLength(payload, "ascii"),
    };
    if (this.transmission.bytes > MAX_BASE64_BYTES) {
      this.stats.droppedBytes += this.transmission.bytes;
      this.transmission = undefined;
      return Buffer.alloc(0);
    }
    return controls.get("m") === "1" ? Buffer.alloc(0) : this.finishTransmission();
  }

  private continueTransmission(controls: Controls, payload: string): Buffer {
    const transmission = this.transmission;
    if (!transmission) return Buffer.alloc(0);
    transmission.payload.push(payload);
    transmission.bytes += Buffer.byteLength(payload, "ascii");
    if (transmission.bytes > MAX_BASE64_BYTES) {
      this.stats.droppedBytes += transmission.bytes;
      this.transmission = undefined;
      return Buffer.alloc(0);
    }
    return controls.get("m") === "1" ? Buffer.alloc(0) : this.finishTransmission();
  }

  private finishTransmission(): Buffer {
    const transmission = this.transmission;
    this.transmission = undefined;
    if (!transmission) return Buffer.alloc(0);

    const imageId = positiveControl(transmission.controls, "i");
    if (imageId === undefined) {
      this.stats.conversionFailures += 1;
      return Buffer.alloc(0);
    }

    let encoded: Buffer;
    try {
      encoded = Buffer.from(transmission.payload.join(""), "base64");
    } catch {
      this.stats.conversionFailures += 1;
      return Buffer.alloc(0);
    }
    if (encoded.length === 0) {
      this.stats.conversionFailures += 1;
      return Buffer.alloc(0);
    }

    const hash = createHash("sha256").update(encoded).digest("hex");
    const current = this.sources.get(imageId);
    if (!current || current.hash !== hash) {
      this.sources.delete(imageId);
      this.sources.set(imageId, { hash, encoded });
      this.evictSources();
    }
    this.stats.transmissions += 1;
    this.updateCacheStats();
    return this.renderPlacement(transmission.controls);
  }

  private renderPlacement(controls: Controls): Buffer {
    const imageId = positiveControl(controls, "i");
    const columns = positiveControl(controls, "c");
    const rows = positiveControl(controls, "r");
    if (imageId === undefined || columns === undefined || rows === undefined) return Buffer.alloc(0);

    const source = this.sources.get(imageId);
    if (!source) return Buffer.alloc(0);
    this.sources.delete(imageId);
    this.sources.set(imageId, source);

    source.decoded ??= decodeImage(source.encoded);
    if (!source.decoded) {
      this.stats.conversionFailures += 1;
      return Buffer.alloc(0);
    }

    const cell = this.getCellDimensions();
    const crop = sourceCrop(controls, source.decoded);
    const targetWidth = Math.max(1, columns * cell.widthPx);
    const targetHeight = Math.max(1, rows * cell.heightPx);
    if (targetWidth * targetHeight > MAX_TARGET_PIXELS) {
      this.stats.conversionFailures += 1;
      return Buffer.alloc(0);
    }

    const cacheKey = [
      source.hash,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      targetWidth,
      targetHeight,
      this.maxColors,
    ].join(":");
    const cached = this.renderCache.get(cacheKey);
    if (cached) {
      this.renderCache.delete(cacheKey);
      this.renderCache.set(cacheKey, cached);
      this.stats.cacheHits += 1;
      return Buffer.concat([CURSOR_SAVE, cached.data, CURSOR_RESTORE]);
    }

    this.stats.cacheMisses += 1;
    try {
      const resized = resizeToFit(source.decoded, targetWidth, targetHeight, crop);
      const sixel = encodeSixel(resized, { maxColors: this.maxColors });
      this.addCachedRender(cacheKey, sixel);
      return Buffer.concat([CURSOR_SAVE, sixel, CURSOR_RESTORE]);
    } catch {
      this.stats.conversionFailures += 1;
      return Buffer.alloc(0);
    }
  }

  private handleDeletion(controls: Controls): void {
    const selector = controls.get("d");
    const imageId = positiveControl(controls, "i");
    if ((selector === "i" || selector === "I") && imageId !== undefined) {
      this.sources.delete(imageId);
      this.updateCacheStats();
    }
  }

  private addCachedRender(key: string, data: Buffer): void {
    const existing = this.renderCache.get(key);
    if (existing) this.renderCacheBytes -= existing.bytes;
    const entry = { data, bytes: data.length };
    this.renderCache.delete(key);
    this.renderCache.set(key, entry);
    this.renderCacheBytes += entry.bytes;

    while (this.renderCache.size > MAX_CACHE_ENTRIES || this.renderCacheBytes > MAX_CACHE_BYTES) {
      const oldestKey = this.renderCache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.renderCache.get(oldestKey);
      this.renderCache.delete(oldestKey);
      this.renderCacheBytes -= oldest?.bytes ?? 0;
    }
    this.updateCacheStats();
  }

  private evictSources(): void {
    while (this.sources.size > 64) {
      const oldestId = this.sources.keys().next().value as number | undefined;
      if (oldestId === undefined) break;
      this.sources.delete(oldestId);
    }
  }

  private updateCacheStats(): void {
    this.stats.sourceImages = this.sources.size;
    this.stats.cachedRenders = this.renderCache.size;
    this.stats.cachedRenderBytes = this.renderCacheBytes;
  }
}
