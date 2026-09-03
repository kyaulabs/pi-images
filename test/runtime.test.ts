import assert from "node:assert/strict";
import test from "node:test";

import { parseTerminalSize } from "../src/runtime.js";

test("derives cell pixels from a tty winsize", () => {
  assert.deepEqual(parseTerminalSize("53 212 3816 2226\n"), {
    widthPx: 18,
    heightPx: 42,
  });
});

test("rejects missing or implausible pixel dimensions", () => {
  assert.equal(parseTerminalSize("53 212 0 0"), undefined);
  assert.equal(parseTerminalSize("not a winsize"), undefined);
});
