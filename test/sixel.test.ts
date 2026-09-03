import assert from "node:assert/strict";
import test from "node:test";

import { encodeSixel, resizeToFit, type RgbaImage } from "../src/sixel.js";

const image: RgbaImage = {
  width: 2,
  height: 1,
  data: Uint8Array.from([
    255, 0, 0, 255,
    0, 255, 0, 255,
  ]),
};

test("resizeToFit preserves aspect ratio", () => {
  const resized = resizeToFit(image, 8, 8);
  assert.equal(resized.width, 8);
  assert.equal(resized.height, 4);
  assert.equal(resized.data.length, 8 * 4 * 4);
});

test("resizeToFit applies a source crop", () => {
  const resized = resizeToFit(image, 4, 4, { x: 1, y: 0, width: 1, height: 1 });
  assert.equal(resized.width, 4);
  assert.equal(resized.height, 4);
  assert.deepEqual([...resized.data.subarray(0, 4)], [0, 255, 0, 255]);
});

test("encodeSixel returns a complete transparent-background DCS", () => {
  const encoded = encodeSixel(image, { maxColors: 16 }).toString("ascii");
  assert.match(encoded, /^\x1bP0;1;0q"1;1;2;1/);
  assert.match(encoded, /#0;2;/);
  assert.ok(encoded.endsWith("\x1b\\"));
});
