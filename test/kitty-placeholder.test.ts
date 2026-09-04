import assert from "node:assert/strict";
import test from "node:test";

import {
  cell,
  deleteImage,
  deletePlacement,
  grid,
  kitty,
  placement,
  tmux,
  upload,
} from "../src/kitty-placeholder.js";

const ESC = "\x1b";

test("wraps Kitty commands directly or through tmux", () => {
  assert.equal(kitty("a=d;", false), `${ESC}_Ga=d;${ESC}\\`);
  const wrapped = kitty("a=d;", true);
  assert.ok(wrapped.startsWith(`${ESC}Ptmux;${ESC}${ESC}_G`));
  assert.ok(wrapped.endsWith(`${ESC}${ESC}\\${ESC}\\`));
  assert.equal(tmux(`${ESC}X`), `${ESC}Ptmux;${ESC}${ESC}X${ESC}\\`);
});

test("chunks uploads and preserves transmission metadata", () => {
  const chunks = upload("a".repeat(4097), 12, 100, false);
  assert.equal(chunks.length, 2);
  assert.match(chunks[0]!, /a=t,f=100,i=12,q=2,m=1;/);
  assert.match(chunks[1]!, /_Gm=0;a/);

  const empty = upload("", 1, 24, false);
  assert.equal(empty.length, 1);
  assert.match(empty[0]!, /a=t,f=24,i=1,q=2,m=0;/);
});

test("builds placements, deletions, cells, and grids", () => {
  assert.match(placement(0x1000000, 2, 3, false), /p=1,U=1,c=2,r=3/);
  assert.match(
    placement(7, 2, 3, false, { x: 1, y: 2, width: 3, height: 4 }),
    /,x=1,y=2,w=3,h=4;/,
  );
  assert.match(deletePlacement(7, false), /a=d,d=i,i=7,p=7,q=2/);
  assert.match(deleteImage(7, true), /a=d,d=I,i=7,q=2/);

  const lowCell = cell(0, 0, 42);
  const highCell = cell(1, 1, 0x0100002a);
  assert.ok(lowCell.includes("\u{10eeee}"));
  assert.ok(highCell.length > lowCell.length);

  const rows = grid(2, 2, 42);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.split("\u{10eeee}").length - 1, 2);
});

test("rejects grids outside the placeholder diacritic table", () => {
  assert.throws(() => grid(300, 1, 1), /exceeds supported diacritic table/);
  assert.throws(() => grid(1, 300, 1), /exceeds supported diacritic table/);
});
