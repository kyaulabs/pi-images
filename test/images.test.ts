import assert from "node:assert/strict";
import test from "node:test";

import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import { decodeImage } from "../src/images.js";

function pngBytes(): Buffer {
  const png = new PNG({ width: 2, height: 1 });
  png.data.set([255, 0, 0, 255, 0, 255, 0, 128]);
  return PNG.sync.write(png);
}

test("decodes PNG and JPEG image bytes", () => {
  const png = decodeImage(pngBytes());
  assert.deepEqual({ width: png?.width, height: png?.height }, { width: 2, height: 1 });
  assert.deepEqual([...png!.data.subarray(0, 4)], [255, 0, 0, 255]);

  const jpegBytes = jpeg.encode(
    { width: 1, height: 1, data: Buffer.from([20, 40, 60, 255]) },
    100,
  ).data;
  const decodedJpeg = decodeImage(jpegBytes);
  assert.deepEqual({ width: decodedJpeg?.width, height: decodedJpeg?.height }, { width: 1, height: 1 });
  assert.equal(decodedJpeg?.data.length, 4);
});

test("rejects unsupported and malformed image bytes", () => {
  assert.equal(decodeImage(Buffer.from("not an image")), undefined);
  assert.equal(decodeImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00])), undefined);
  assert.equal(decodeImage(Buffer.from([0xff, 0xd8, 0x00])), undefined);
});
