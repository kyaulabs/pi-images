import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import type { RgbaImage } from "./sixel.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export function decodeImage(data: Buffer): RgbaImage | undefined {
  try {
    if (data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      const decoded = PNG.sync.read(data);
      return { width: decoded.width, height: decoded.height, data: decoded.data };
    }

    if (data[0] === 0xff && data[1] === 0xd8) {
      const decoded = jpeg.decode(data, { formatAsRGBA: true, useTArray: true });
      return {
        width: decoded.width,
        height: decoded.height,
        data: decoded.data as Uint8Array,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}
