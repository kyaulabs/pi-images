export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SixelEncodeOptions {
  maxColors?: number;
  transparentAlpha?: number;
}

const SIXEL_TRANSPARENT = 0xff;
const HISTOGRAM_SIZE = 1 << 15;

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

export function normalizeCrop(image: RgbaImage, crop?: Partial<CropRect>): CropRect {
  const x = clampInteger(crop?.x ?? 0, 0, Math.max(0, image.width - 1));
  const y = clampInteger(crop?.y ?? 0, 0, Math.max(0, image.height - 1));
  const width = clampInteger(crop?.width ?? image.width - x, 1, image.width - x);
  const height = clampInteger(crop?.height ?? image.height - y, 1, image.height - y);
  return { x, y, width, height };
}

/** Resize a source crop to fit a pixel box while preserving its aspect ratio. */
export function resizeToFit(
  image: RgbaImage,
  maximumWidth: number,
  maximumHeight: number,
  crop?: Partial<CropRect>,
): RgbaImage {
  const source = normalizeCrop(image, crop);
  const boxWidth = Math.max(1, Math.floor(maximumWidth));
  const boxHeight = Math.max(1, Math.floor(maximumHeight));
  const scale = Math.min(boxWidth / source.width, boxHeight / source.height);
  const width = Math.max(1, Math.min(boxWidth, Math.round(source.width * scale)));
  const height = Math.max(1, Math.min(boxHeight, Math.round(source.height * scale)));
  const data = new Uint8Array(width * height * 4);

  for (let targetY = 0; targetY < height; targetY += 1) {
    const sourceY = source.y + Math.min(source.height - 1, Math.floor((targetY * source.height) / height));
    for (let targetX = 0; targetX < width; targetX += 1) {
      const sourceX = source.x + Math.min(source.width - 1, Math.floor((targetX * source.width) / width));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const targetOffset = (targetY * width + targetX) * 4;
      data[targetOffset] = image.data[sourceOffset] ?? 0;
      data[targetOffset + 1] = image.data[sourceOffset + 1] ?? 0;
      data[targetOffset + 2] = image.data[sourceOffset + 2] ?? 0;
      data[targetOffset + 3] = image.data[sourceOffset + 3] ?? 255;
    }
  }

  return { width, height, data };
}

function colorBucket(red: number, green: number, blue: number): number {
  return ((red >>> 3) << 10) | ((green >>> 3) << 5) | (blue >>> 3);
}

function appendRun(parts: string[], bits: number, length: number): void {
  if (length < 1) return;
  const character = String.fromCharCode(0x3f + bits);
  if (length >= 4) parts.push(`!${length}${character}`);
  else parts.push(character.repeat(length));
}

interface QuantizedImage {
  palette: Array<readonly [number, number, number]>;
  pixels: Uint8Array;
}

function quantize(image: RgbaImage, requestedColors: number, transparentAlpha: number): QuantizedImage {
  const maximumColors = clampInteger(requestedColors, 2, 254);
  const counts = new Uint32Array(HISTOGRAM_SIZE);
  const redSums = new Float64Array(HISTOGRAM_SIZE);
  const greenSums = new Float64Array(HISTOGRAM_SIZE);
  const blueSums = new Float64Array(HISTOGRAM_SIZE);

  for (let offset = 0; offset < image.data.length; offset += 4) {
    const alpha = image.data[offset + 3] ?? 255;
    if (alpha < transparentAlpha) continue;
    const factor = alpha / 255;
    const red = Math.round((image.data[offset] ?? 0) * factor);
    const green = Math.round((image.data[offset + 1] ?? 0) * factor);
    const blue = Math.round((image.data[offset + 2] ?? 0) * factor);
    const bucket = colorBucket(red, green, blue);
    counts[bucket] = counts[bucket]! + 1;
    redSums[bucket] = redSums[bucket]! + red;
    greenSums[bucket] = greenSums[bucket]! + green;
    blueSums[bucket] = blueSums[bucket]! + blue;
  }

  const populated: number[] = [];
  for (let bucket = 0; bucket < HISTOGRAM_SIZE; bucket += 1) {
    if (counts[bucket]! > 0) populated.push(bucket);
  }
  populated.sort((left, right) => counts[right]! - counts[left]!);

  const palette = populated.slice(0, maximumColors).map((bucket) => {
    const count = counts[bucket]!;
    return [
      Math.round(redSums[bucket]! / count),
      Math.round(greenSums[bucket]! / count),
      Math.round(blueSums[bucket]! / count),
    ] as const;
  });

  const pixels = new Uint8Array(image.width * image.height);
  pixels.fill(SIXEL_TRANSPARENT);
  if (palette.length === 0) return { palette, pixels };

  const bucketMapping = new Int16Array(HISTOGRAM_SIZE);
  bucketMapping.fill(-1);
  for (let index = 0; index < palette.length; index += 1) {
    bucketMapping[populated[index]!] = index;
  }

  for (let pixel = 0, offset = 0; offset < image.data.length; pixel += 1, offset += 4) {
    const alpha = image.data[offset + 3] ?? 255;
    if (alpha < transparentAlpha) continue;
    const factor = alpha / 255;
    const red = Math.round((image.data[offset] ?? 0) * factor);
    const green = Math.round((image.data[offset + 1] ?? 0) * factor);
    const blue = Math.round((image.data[offset + 2] ?? 0) * factor);
    const bucket = colorBucket(red, green, blue);
    let paletteIndex = bucketMapping[bucket]!;

    if (paletteIndex < 0) {
      let nearestDistance = Number.POSITIVE_INFINITY;
      paletteIndex = 0;
      for (let candidate = 0; candidate < palette.length; candidate += 1) {
        const color = palette[candidate]!;
        const redDelta = color[0] - red;
        const greenDelta = color[1] - green;
        const blueDelta = color[2] - blue;
        const distance = redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          paletteIndex = candidate;
        }
      }
      bucketMapping[bucket] = paletteIndex;
    }

    pixels[pixel] = paletteIndex;
  }

  return { palette, pixels };
}

/** Encode an RGBA bitmap as a complete 7-bit DEC SIXEL DCS sequence. */
export function encodeSixel(image: RgbaImage, options: SixelEncodeOptions = {}): Buffer {
  const { palette, pixels } = quantize(
    image,
    options.maxColors ?? 128,
    options.transparentAlpha ?? 8,
  );
  const parts: string[] = [`\x1bP0;1;0q"1;1;${image.width};${image.height}`];

  for (let index = 0; index < palette.length; index += 1) {
    const color = palette[index]!;
    const red = Math.round((color[0] * 100) / 255);
    const green = Math.round((color[1] * 100) / 255);
    const blue = Math.round((color[2] * 100) / 255);
    parts.push(`#${index};2;${red};${green};${blue}`);
  }

  const bands = Math.ceil(image.height / 6);
  for (let band = 0; band < bands; band += 1) {
    const planes = new Map<number, Uint8Array>();
    const firstY = band * 6;

    for (let bit = 0; bit < 6; bit += 1) {
      const y = firstY + bit;
      if (y >= image.height) break;
      for (let x = 0; x < image.width; x += 1) {
        const color = pixels[y * image.width + x]!;
        if (color === SIXEL_TRANSPARENT) continue;
        let plane = planes.get(color);
        if (!plane) {
          plane = new Uint8Array(image.width);
          planes.set(color, plane);
        }
        plane[x] = plane[x]! | (1 << bit);
      }
    }

    let firstPlane = true;
    for (const [color, plane] of planes) {
      if (!firstPlane) parts.push("$");
      firstPlane = false;
      parts.push(`#${color}`);

      let finalColumn = plane.length - 1;
      while (finalColumn >= 0 && plane[finalColumn] === 0) finalColumn -= 1;
      let runBits = -1;
      let runLength = 0;
      for (let x = 0; x <= finalColumn; x += 1) {
        const bits = plane[x]!;
        if (bits === runBits) runLength += 1;
        else {
          appendRun(parts, runBits, runLength);
          runBits = bits;
          runLength = 1;
        }
      }
      appendRun(parts, runBits, runLength);
    }

    if (band + 1 < bands) parts.push("-");
  }

  parts.push("\x1b\\");
  return Buffer.from(parts.join(""), "ascii");
}
