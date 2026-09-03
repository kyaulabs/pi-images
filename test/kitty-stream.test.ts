import assert from "node:assert/strict";
import test from "node:test";

import { PNG } from "pngjs";

import { KittyStreamTranslator } from "../src/kitty-stream.js";

function testPngBase64(): string {
  const png = new PNG({ width: 2, height: 1 });
  png.data.set([
    255, 0, 0, 255,
    0, 0, 255, 255,
  ]);
  return PNG.sync.write(png).toString("base64");
}

function createTranslator(): KittyStreamTranslator {
  return new KittyStreamTranslator({
    getCellDimensions: () => ({ widthPx: 2, heightPx: 4 }),
    maxColors: 16,
  });
}

test("passes ordinary terminal bytes through unchanged", () => {
  const translator = createTranslator();
  assert.equal(translator.push(Buffer.from("hello\n")).toString(), "hello\n");
});

test("translates a single Kitty transmission to cursor-preserving SIXEL", () => {
  const translator = createTranslator();
  const kitty = `\x1b_Ga=T,f=100,q=2,C=1,c=2,r=1,i=42;${testPngBase64()}\x1b\\`;
  const output = translator.push(Buffer.from(`before${kitty}after`));
  const text = output.toString("ascii");

  assert.ok(text.startsWith("before\x1b7\x1bP0;1;0q"));
  assert.ok(text.endsWith("\x1b\\\x1b8after"));
  assert.equal(text.includes("\x1b_G"), false);
  assert.equal(translator.stats.transmissions, 1);
  assert.equal(translator.stats.cacheMisses, 1);
});

test("reassembles both terminal-write and Kitty payload boundaries", () => {
  const translator = createTranslator();
  const base64 = testPngBase64();
  const midpoint = Math.floor(base64.length / 2);
  const kitty = [
    `\x1b_Ga=T,f=100,q=2,C=1,c=2,r=1,i=7,m=1;${base64.slice(0, midpoint)}\x1b\\`,
    `\x1b_Gm=0;${base64.slice(midpoint)}\x1b\\`,
  ].join("");
  const input = Buffer.from(`x${kitty}y`);
  const output: Buffer[] = [];

  for (const byte of input) {
    const translated = translator.push(Buffer.of(byte));
    if (translated.length > 0) output.push(translated);
  }

  const text = Buffer.concat(output).toString("ascii");
  assert.ok(text.startsWith("x\x1b7\x1bP"));
  assert.ok(text.endsWith("\x1b8y"));
  assert.equal(text.includes(base64.slice(0, 20)), false);
  assert.equal(translator.stats.transmissions, 1);
});

test("replays a cached image for placement-only commands", () => {
  const translator = createTranslator();
  const base64 = testPngBase64();
  translator.push(Buffer.from(`\x1b_Ga=T,f=100,c=2,r=1,i=9;${base64}\x1b\\`));
  const placement = translator.push(Buffer.from("\x1b_Ga=p,q=2,c=2,r=1,i=9\x1b\\"));

  assert.ok(placement.toString("ascii").includes("\x1bP0;1;0q"));
  assert.equal(translator.stats.placements, 1);
  assert.equal(translator.stats.cacheHits, 1);
});

test("forgets specifically deleted image sources", () => {
  const translator = createTranslator();
  const base64 = testPngBase64();
  translator.push(Buffer.from(`\x1b_Ga=T,f=100,c=2,r=1,i=11;${base64}\x1b\\`));
  translator.push(Buffer.from("\x1b_Ga=d,d=I,i=11,q=2\x1b\\"));
  const placement = translator.push(Buffer.from("\x1b_Ga=p,q=2,c=2,r=1,i=11\x1b\\"));

  assert.equal(placement.length, 0);
  assert.equal(translator.stats.sourceImages, 0);
});
