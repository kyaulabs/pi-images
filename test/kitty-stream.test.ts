import assert from "node:assert/strict";
import test from "node:test";

import { PNG } from "pngjs";

import { KittyStreamTranslator, type TranslationMode } from "../src/kitty-stream.js";

function testPngBase64(): string {
  const png = new PNG({ width: 2, height: 1 });
  png.data.set([
    255, 0, 0, 255,
    0, 0, 255, 255,
  ]);
  return PNG.sync.write(png).toString("base64");
}

function createTranslator(mode: TranslationMode = "sixel"): KittyStreamTranslator {
  return new KittyStreamTranslator({
    getCellDimensions: () => ({ widthPx: 2, heightPx: 4 }),
    mode,
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

test("uses tmux passthrough and Unicode cells in Kitty placeholder mode", () => {
  const translator = createTranslator("kitty-placeholder");
  const kitty = `\x1b_Ga=T,f=100,q=2,C=1,c=2,r=2,i=42;${testPngBase64()}\x1b\\`;
  const output = translator.push(Buffer.from(kitty)).toString("utf8");

  assert.ok(output.startsWith("\x1bPtmux;"));
  assert.match(output, /a=t,f=100,i=42,q=2,m=0/);
  assert.match(output, /a=p,i=42,p=42,U=1,c=2,r=2,q=2/);
  assert.equal(output.split("\u{10eeee}").length - 1, 4);
  assert.ok(output.endsWith("\x1b[1A\r\x1b[?7h"));
  assert.equal(translator.stats.transmissions, 1);
  assert.equal(translator.stats.conversionFailures, 0);
});

test("passes Kitty deletion commands through in placeholder mode", () => {
  const translator = createTranslator("kitty-placeholder");
  const deletion = translator
    .push(Buffer.from("\x1b_Ga=d,d=A,q=2\x1b\\"))
    .toString("ascii");

  assert.ok(deletion.startsWith("\x1bPtmux;"));
  assert.ok(deletion.includes("a=d,d=A,q=2"));
  assert.ok(deletion.endsWith("\x1b\\"));
});

test("handles empty writes and every partial Kitty prefix boundary", () => {
  const translator = createTranslator();
  assert.equal(translator.push(Buffer.alloc(0)).length, 0);
  assert.equal(translator.push(Buffer.from("one\x1b")).toString(), "one");
  assert.equal(translator.push(Buffer.from("_two")).toString(), "\x1b_two");
  assert.equal(translator.push(Buffer.from("three\x1b_")).toString(), "three");
  assert.equal(translator.push(Buffer.from("x")).toString(), "\x1b_x");

  assert.equal(translator.push(Buffer.from("\x1b_Ga=T,i=1;m")).length, 0);
  translator.reset();
  assert.deepEqual(translator.stats, {
    transmissions: 0,
    placements: 0,
    cacheHits: 0,
    cacheMisses: 0,
    conversionFailures: 0,
    droppedBytes: 0,
    sourceImages: 0,
    cachedRenders: 0,
    cachedRenderBytes: 0,
  });
});

test("drops unknown, incomplete, and malformed commands", () => {
  const translator = createTranslator();
  assert.equal(translator.push(Buffer.from("\x1b_Gq=2;ignored\x1b\\")).length, 0);
  assert.equal(translator.push(Buffer.from("\x1b_Ga=p,c=1,r=1\x1b\\")).length, 0);
  assert.equal(translator.push(Buffer.from("\x1b_Ga=p,i=1,r=1\x1b\\")).length, 0);
  assert.equal(translator.push(Buffer.from("\x1b_Ga=p,i=1,c=1\x1b\\")).length, 0);
  assert.equal(translator.push(Buffer.from("\x1b_Ga=p,i=no,c=1,r=1\x1b\\")).length, 0);
  assert.equal(translator.push(Buffer.from("\x1b_Ga=p,i=9007199254740992,c=1,r=1\x1b\\")).length, 0);
  assert.equal(translator.push(Buffer.from("\x1b_Ga=T,c=1,r=1;YQ==\x1b\\")).length, 0);
  assert.equal(translator.push(Buffer.from("\x1b_Ga=T,i=1,c=1,r=1;%%%%\x1b\\")).length, 0);
  assert.equal(translator.stats.conversionFailures, 2);
});

test("drops invalid images and placements larger than the pixel limit", () => {
  const translator = new KittyStreamTranslator({
    getCellDimensions: () => ({ widthPx: 2_000, heightPx: 2_000 }),
    maxColors: 999,
  });
  const invalid = Buffer.from("not an image").toString("base64");
  assert.equal(
    translator.push(Buffer.from(`\x1b_Ga=T,i=1,c=1,r=1;${invalid}\x1b\\`)).length,
    0,
  );
  const png = testPngBase64();
  assert.equal(
    translator.push(Buffer.from(`\x1b_Ga=T,i=2,c=1,r=1;${png}\x1b\\`)).length,
    0,
  );
  assert.equal(translator.stats.conversionFailures, 2);
});

test("replaces changed sources and applies source crops", () => {
  const translator = createTranslator();
  const first = testPngBase64();
  const secondPng = new PNG({ width: 1, height: 1 });
  secondPng.data.set([0, 255, 0, 255]);
  const second = PNG.sync.write(secondPng).toString("base64");

  translator.push(Buffer.from(`\x1b_Ga=T,i=3,c=1,r=1;${first}\x1b\\`));
  translator.push(Buffer.from(`\x1b_Ga=T,i=3,c=1,r=1;${first}\x1b\\`));
  const replaced = translator.push(
    Buffer.from(`\x1b_Ga=T,i=3,c=1,r=1,x=-2,y=0,w=1,h=1;${second}\x1b\\`),
  );
  assert.ok(replaced.toString("ascii").includes("\x1bP0;1;0q"));
  assert.equal(translator.stats.transmissions, 3);
});

test("counts failed placeholder grids without leaking commands", () => {
  const translator = createTranslator("kitty-placeholder");
  const kitty = `\x1b_Ga=T,f=100,c=300,r=1,i=42;${testPngBase64()}\x1b\\`;
  const output = translator.push(Buffer.from(kitty));
  assert.match(output.toString("utf8"), /a=t,f=100,i=42/);
  assert.equal(output.toString("utf8").includes("\u{10eeee}"), false);
  assert.equal(translator.stats.conversionFailures, 1);
});

test("evicts old source images and bounded render-cache entries", () => {
  let widthPx = 1;
  const translator = new KittyStreamTranslator({
    getCellDimensions: () => ({ widthPx, heightPx: 1 }),
    maxColors: 1,
  });
  const png = testPngBase64();

  for (let imageId = 1; imageId <= 65; imageId += 1) {
    translator.push(Buffer.from(`\x1b_Ga=T,i=${imageId},c=1,r=1;${png}\x1b\\`));
  }
  assert.equal(translator.stats.sourceImages, 64);
  assert.equal(translator.push(Buffer.from("\x1b_Ga=p,i=1,c=1,r=1\x1b\\")).length, 0);

  for (widthPx = 2; widthPx <= 100; widthPx += 1) {
    translator.push(Buffer.from("\x1b_Ga=p,i=65,c=1,r=1\x1b\\"));
  }
  assert.equal(translator.stats.cachedRenders, 96);
  assert.ok(translator.stats.cachedRenderBytes > 0);
});

test("enforces lowered transmission limits for initial and continued payloads", () => {
  const minimum = new KittyStreamTranslator({
    getCellDimensions: () => ({ widthPx: 1, heightPx: 1 }),
    maxTransmissionBytes: 0,
  });
  assert.equal(minimum.push(Buffer.from("\x1b_Ga=T,i=1;AA\x1b\\")).length, 0);

  new KittyStreamTranslator({
    getCellDimensions: () => ({ widthPx: 1, heightPx: 1 }),
    maxTransmissionBytes: Number.MAX_SAFE_INTEGER,
  });

  const direct = new KittyStreamTranslator({
    getCellDimensions: () => ({ widthPx: 1, heightPx: 1 }),
    maxTransmissionBytes: 4,
  });
  assert.equal(direct.push(Buffer.from("\x1b_Ga=T,i=1;AAAAA\x1b\\")).length, 0);
  assert.equal(direct.stats.droppedBytes, 5);

  const continued = new KittyStreamTranslator({
    getCellDimensions: () => ({ widthPx: 1, heightPx: 1 }),
    maxTransmissionBytes: 4,
  });
  continued.push(Buffer.from("\x1b_Ga=T,i=1,m=1;AAAA\x1b\\"));
  assert.equal(continued.push(Buffer.from("\x1b_Gm=0;A\x1b\\")).length, 0);
  assert.equal(continued.stats.droppedBytes, 5);
});

test("fails closed when terminal dimensions cannot be read", () => {
  const translator = new KittyStreamTranslator({
    getCellDimensions: () => {
      throw new Error("unavailable");
    },
  });
  const output = translator.push(
    Buffer.from(`\x1b_Ga=T,i=1,c=1,r=1;${testPngBase64()}\x1b\\`),
  );
  assert.equal(output.length, 0);
  assert.equal(translator.stats.conversionFailures, 1);
});

test("defaults placeholder uploads to PNG format", () => {
  const translator = createTranslator("kitty-placeholder");
  const output = translator.push(
    Buffer.from(`\x1b_Ga=T,,i=5,c=1,r=1;${testPngBase64()}\x1b\\`),
  );
  assert.match(output.toString("utf8"), /a=t,f=100,i=5/);
});

test("supports continuation payloads and both image deletion selectors", () => {
  const translator = createTranslator();
  const base64 = testPngBase64();
  const midpoint = Math.floor(base64.length / 2);
  translator.push(Buffer.from(`\x1b_Ga=T,i=77,c=1,r=1,m=1;${base64.slice(0, midpoint)}\x1b\\`));
  const output = translator.push(Buffer.from(`\x1b_G;${base64.slice(midpoint)}\x1b\\`));
  assert.ok(output.length > 0);

  translator.push(Buffer.from("\x1b_Ga=d,d=i,i=77\x1b\\"));
  assert.equal(translator.stats.sourceImages, 0);
  assert.equal(translator.push(Buffer.from("\x1b_Ga=d,d=i,i=-1\x1b\\")).length, 0);
});
