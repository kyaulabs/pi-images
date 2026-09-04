import assert from "node:assert/strict";
import test from "node:test";

import { encodeSixel, normalizeCrop, resizeToFit, type RgbaImage } from "../src/sixel.js";

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

  const heightLimited = resizeToFit(
    { width: 1, height: 2, data: Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255]) },
    9,
    3,
  );
  assert.deepEqual({ width: heightLimited.width, height: heightLimited.height }, { width: 2, height: 3 });
});

test("normalizes default, fractional, and out-of-bounds crops", () => {
  assert.deepEqual(normalizeCrop(image), { x: 0, y: 0, width: 2, height: 1 });
  assert.deepEqual(normalizeCrop(image, { x: -2, y: 4, width: 99, height: 0 }), {
    x: 0,
    y: 0,
    width: 2,
    height: 1,
  });
  assert.deepEqual(normalizeCrop(image, { x: 1.9, width: 1.8 }), {
    x: 1,
    y: 0,
    width: 1,
    height: 1,
  });
  assert.deepEqual(normalizeCrop({ width: 0, height: 0, data: new Uint8Array() }), {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
});

test("fills missing channels while resizing incomplete source data", () => {
  const resized = resizeToFit({ width: 1, height: 1, data: Uint8Array.of(10) }, 0, -1);
  assert.deepEqual([...resized.data], [10, 0, 0, 255]);
});

test("encodeSixel returns a complete transparent-background DCS", () => {
  const encoded = encodeSixel(image, { maxColors: 16 }).toString("ascii");
  assert.match(encoded, /^\x1bP0;1;0q"1;1;2;1/);
  assert.match(encoded, /#0;2;/);
  assert.ok(encoded.endsWith("\x1b\\"));
  assert.ok(encodeSixel(image, { maxColors: 1 }).length > 0);
  assert.ok(
    encodeSixel({ width: 0, height: 0, data: new Uint8Array() }).toString("ascii").endsWith("\x1b\\"),
  );
});

test("encodes transparency, repeated runs, color reduction, and multiple bands", () => {
  const transparent = encodeSixel({
    width: 4,
    height: 7,
    data: new Uint8Array(4 * 7 * 4),
  }).toString("ascii");
  assert.equal(transparent.includes("#0;2;"), false);
  assert.ok(transparent.includes("-"));

  const data = new Uint8Array(5 * 7 * 4);
  for (let pixel = 0; pixel < 35; pixel += 1) {
    const offset = pixel * 4;
    data[offset] = (pixel % 3) * 100;
    data[offset + 1] = ((pixel + 1) % 3) * 100;
    data[offset + 2] = ((pixel + 2) % 3) * 100;
    data[offset + 3] = pixel === 0 ? 4 : 128;
  }
  const reduced = encodeSixel(
    { width: 5, height: 7, data },
    { maxColors: 2, transparentAlpha: 8 },
  ).toString("ascii");
  assert.ok(reduced.includes("$"));
  assert.ok(reduced.includes("-"));

  const repeated = encodeSixel({
    width: 5,
    height: 1,
    data: Uint8Array.from(Array.from({ length: 5 }, () => [255, 0, 0, 255]).flat()),
  }).toString("ascii");
  assert.match(repeated, /!5/);

  const incomplete = encodeSixel(
    { width: 1, height: 1, data: Uint8Array.of(200) },
    { maxColors: 999, transparentAlpha: 0 },
  ).toString("ascii");
  assert.match(incomplete, /#0;2;/);
});
