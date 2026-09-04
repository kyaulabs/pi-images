import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireBridge,
  createCellDimensionProvider,
  formatBridgeStatus,
  parseTerminalSize,
  type BridgeHandle,
} from "../src/runtime.js";

const ENV_KEYS = [
  "PATH",
  "PI_IMAGE_PROTOCOL",
  "PI_IMAGES",
  "PI_IMAGES_CELL_HEIGHT",
  "PI_IMAGES_CELL_WIDTH",
  "PI_IMAGES_COLORS",
  "PI_IMAGES_MODE",
  "PI_SIXEL",
  "PI_SIXEL_CELL_HEIGHT",
  "PI_SIXEL_CELL_WIDTH",
  "PI_SIXEL_COLORS",
  "TEST_PASSTHROUGH",
  "TEST_PASSTHROUGH_STATUS",
  "TEST_PYTHON_OUTPUT",
  "TEST_PYTHON_STATUS",
  "TEST_TMUX_DISPLAY",
  "TEST_TMUX_DISPLAY_STATUS",
  "TMUX",
] as const;

interface TestEnvironment {
  directory: string;
  values?: Record<string, string | undefined>;
  isTTY?: boolean;
}

function createFakeCommands(): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-images-test-"));
  writeFileSync(
    join(directory, "tmux"),
    `#!/bin/sh
if [ "$1" = "display-message" ]; then
  printf '%s\\n' "\${TEST_TMUX_DISPLAY:-1|sixel|xterm-sixel}"
  exit "\${TEST_TMUX_DISPLAY_STATUS:-0}"
fi
printf '%s\\n' "\${TEST_PASSTHROUGH:-on}"
exit "\${TEST_PASSTHROUGH_STATUS:-0}"
`,
  );
  writeFileSync(
    join(directory, "python3"),
    `#!/bin/sh
printf '%s\\n' "\${TEST_PYTHON_OUTPUT:-24 80 720 432}"
exit "\${TEST_PYTHON_STATUS:-0}"
`,
  );
  chmodSync(join(directory, "tmux"), 0o755);
  chmodSync(join(directory, "python3"), 0o755);
  return directory;
}

function withEnvironment<T>(environment: TestEnvironment, callback: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.PATH = `${environment.directory}:${saved.get("PATH") ?? ""}`;
  for (const [key, value] of Object.entries(environment.values ?? {})) {
    if (value !== undefined) process.env[key] = value;
  }

  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: environment.isTTY ?? true,
  });

  try {
    return callback();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (ttyDescriptor) Object.defineProperty(process.stdout, "isTTY", ttyDescriptor);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
}

function acquireFor(
  directory: string,
  values: Record<string, string | undefined>,
  isTTY = true,
): BridgeHandle {
  return withEnvironment(
    {
      directory,
      isTTY,
      values: {
        TMUX: "test",
        TEST_TMUX_DISPLAY: "1|sixel|xterm-sixel",
        ...values,
      },
    },
    () => acquireBridge(),
  );
}

test("derives cell pixels from a tty winsize", () => {
  assert.deepEqual(parseTerminalSize("53 212 3816 2226\n"), {
    widthPx: 18,
    heightPx: 42,
  });
});

test("rejects malformed or implausible terminal sizes", () => {
  for (const value of [
    "53 212 0 0",
    "not a winsize",
    "0 80 720 432",
    "24 0 720 432",
    "24 80 79 432",
    "24 80 720 23",
    "1 1 101 1",
    "1 1 1 201",
  ]) {
    assert.equal(parseTerminalSize(value), undefined, value);
  }
});

test("uses configured, detected, and fallback cell dimensions", (context) => {
  const directory = createFakeCommands();
  try {
    withEnvironment(
      {
        directory,
        values: { PI_IMAGES_CELL_WIDTH: "10", PI_IMAGES_CELL_HEIGHT: "20" },
      },
      () => assert.deepEqual(createCellDimensionProvider()(), { widthPx: 10, heightPx: 20 }),
    );
    withEnvironment(
      {
        directory,
        values: { PI_SIXEL_CELL_WIDTH: "11", PI_SIXEL_CELL_HEIGHT: "21" },
      },
      () => assert.deepEqual(createCellDimensionProvider()(), { widthPx: 11, heightPx: 21 }),
    );
    for (const configured of [
      { PI_IMAGES_CELL_WIDTH: "0", PI_IMAGES_CELL_HEIGHT: "20" },
      { PI_IMAGES_CELL_WIDTH: "10" },
    ]) {
      withEnvironment(
        {
          directory,
          values: { ...configured, TEST_PYTHON_OUTPUT: "24 80 720 432" },
        },
        () => assert.deepEqual(createCellDimensionProvider()(), { widthPx: 9, heightPx: 18 }),
      );
    }
    withEnvironment(
      { directory, values: { TEST_PYTHON_STATUS: "1" } },
      () => assert.deepEqual(createCellDimensionProvider()(), { widthPx: 9, heightPx: 18 }),
    );

    let now = 1_000;
    context.mock.method(Date, "now", () => now);
    withEnvironment(
      {
        directory,
        values: { PI_IMAGES_CELL_WIDTH: "8", PI_IMAGES_CELL_HEIGHT: "16" },
      },
      () => {
        const dimensions = createCellDimensionProvider();
        process.env.PI_IMAGES_CELL_WIDTH = "12";
        process.env.PI_IMAGES_CELL_HEIGHT = "24";
        now = 2_999;
        assert.deepEqual(dimensions(), { widthPx: 8, heightPx: 16 });
        now = 3_000;
        assert.deepEqual(dimensions(), { widthPx: 12, heightPx: 24 });
      },
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("reports every inactive activation guard", () => {
  const directory = createFakeCommands();
  try {
    const cases: Array<[Record<string, string | undefined>, boolean, string]> = [
      [{ PI_IMAGES: "OFF" }, true, "disabled by PI_IMAGES"],
      [{ PI_SIXEL: "0" }, true, "disabled by PI_IMAGES"],
      [{ TMUX: undefined }, true, "not running in tmux"],
      [{}, false, "stdout is not a terminal"],
      [{ PI_IMAGE_PROTOCOL: "none" }, true, "PI_IMAGE_PROTOCOL=none"],
      [{ PI_IMAGE_PROTOCOL: "0" }, true, "PI_IMAGE_PROTOCOL=0"],
      [{ PI_IMAGE_PROTOCOL: "ITERM2" }, true, "PI_IMAGE_PROTOCOL=iterm2"],
      [{ TEST_TMUX_DISPLAY_STATUS: "1" }, true, "unable to query tmux"],
      [
        { PI_IMAGES_MODE: "placeholder", TEST_PASSTHROUGH: "off" },
        true,
        "tmux allow-passthrough is not enabled",
      ],
      [
        { PI_IMAGES_MODE: "placeholder", TEST_PASSTHROUGH_STATUS: "1" },
        true,
        "tmux allow-passthrough is not enabled",
      ],
      [{ TEST_TMUX_DISPLAY: "0|sixel|xterm-sixel" }, true, "tmux was built without SIXEL support"],
      [
        { TEST_TMUX_DISPLAY: "1|extkeys|xterm-example" },
        true,
        "xterm-example is not marked with the tmux sixel feature",
      ],
      [{ TEST_TMUX_DISPLAY: "1" }, true, "unknown is not marked with the tmux sixel feature"],
    ];

    for (const [values, isTTY, reason] of cases) {
      const handle = acquireFor(directory, values, isTTY);
      assert.equal(handle.active, false);
      assert.equal(handle.reason, reason);
      handle.release();
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("selects placeholder and SIXEL activation modes", () => {
  const directory = createFakeCommands();
  try {
    const cases: Array<[Record<string, string | undefined>, string, string]> = [
      [
        { TEST_TMUX_DISPLAY: "1|extkeys|xterm-ghostty", TEST_PASSTHROUGH: "all" },
        "kitty-placeholder",
        "tmux client xterm-ghostty supports Kitty Unicode placeholders",
      ],
      [
        { PI_IMAGES_MODE: "KITTY-PLACEHOLDER", TEST_TMUX_DISPLAY: "1||xterm-other" },
        "kitty-placeholder",
        "tmux client xterm-other supports Kitty Unicode placeholders",
      ],
      [
        { TEST_TMUX_DISPLAY: "1|sixel,extkeys|xterm-sixel" },
        "sixel",
        "tmux client xterm-sixel supports SIXEL",
      ],
      [
        { PI_IMAGES_MODE: "sixel", TEST_TMUX_DISPLAY: "1|extkeys|xterm-other" },
        "sixel",
        "SIXEL mode forced by configuration",
      ],
      [
        { PI_IMAGES: "force", TEST_TMUX_DISPLAY: "1||xterm-other" },
        "sixel",
        "SIXEL mode forced by configuration",
      ],
      [
        { PI_IMAGES: "1", TEST_TMUX_DISPLAY: "1||xterm-other" },
        "sixel",
        "SIXEL mode forced by configuration",
      ],
    ];

    for (const [values, mode, reason] of cases) {
      const handle = acquireFor(directory, values);
      assert.equal(handle.active, true);
      assert.equal(handle.mode, mode);
      assert.equal(handle.reason, reason);
      handle.release();
    }
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("shares, replaces, writes through, and releases process bridges", async () => {
  const directory = createFakeCommands();
  const actualWrite = process.stdout.write;
  const writes: Buffer[] = [];
  const sink = (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    writes.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    done?.(null);
    return true;
  };

  process.stdout.write = sink;
  try {
    withEnvironment(
      {
        directory,
        values: {
          TMUX: "test",
          PI_IMAGES_MODE: "sixel",
          PI_IMAGES_COLORS: "not-a-number",
          PI_SIXEL_COLORS: "16",
          PI_IMAGES_CELL_WIDTH: "2",
          PI_IMAGES_CELL_HEIGHT: "4",
          TEST_TMUX_DISPLAY: "1||xterm-sixel",
        },
      },
      () => {
        const first = acquireBridge();
        const patchedWrite = process.stdout.write;
        const second = acquireBridge();
        assert.equal(process.stdout.write, patchedWrite);
        assert.equal(first.stats, second.stats);

        let callbackCalled = false;
        const bytes = Uint8Array.from([0, 65, 66, 0]).subarray(1, 3);
        assert.equal(process.stdout.write(bytes, () => (callbackCalled = true)), true);
        assert.equal(process.stdout.write("C"), true);
        assert.equal(process.stdout.write("D", "utf8", () => (callbackCalled = true)), true);
        assert.equal(callbackCalled, true);
        assert.equal(Buffer.concat(writes).toString(), "ABCD");

        first.release();
        first.release();
        assert.equal(process.stdout.write, patchedWrite);
        second.release();
        assert.equal(process.stdout.write, sink);

        const detached = acquireBridge();
        process.stdout.write = sink;
        detached.release();
        assert.equal(process.stdout.write, sink);
      },
    );

    await withEnvironment(
      {
        directory,
        values: {
          TMUX: "test",
          PI_IMAGES_MODE: "sixel",
          PI_IMAGES_CELL_WIDTH: "2",
          PI_IMAGES_CELL_HEIGHT: "4",
          TEST_TMUX_DISPLAY: "1||xterm-sixel",
        },
      },
      async () => {
        const handle = acquireBridge();
        await new Promise<void>((resolve) => {
          assert.equal(process.stdout.write("\x1b", "ascii", () => resolve()), true);
        });
        handle.release();
      },
    );
  } finally {
    process.stdout.write = actualWrite;
    rmSync(directory, { recursive: true });
  }
});

test("replaces legacy and differently configured bridges", () => {
  const directory = createFakeCommands();
  const bridgeSymbol = Symbol.for("kyaulabs.pi-images.bridge");
  const legacySymbol = Symbol.for("kyaulabs.pi-sixel.bridge");
  const globals = globalThis as Record<symbol, unknown>;
  let legacyUninstalls = 0;
  globals[legacySymbol] = { uninstall: () => (legacyUninstalls += 1) };

  try {
    withEnvironment(
      {
        directory,
        values: {
          TMUX: "test",
          PI_IMAGES_MODE: "sixel",
          PI_IMAGES_CELL_WIDTH: "2",
          PI_IMAGES_CELL_HEIGHT: "4",
          TEST_TMUX_DISPLAY: "1||xterm-sixel",
        },
      },
      () => {
        const sixel = acquireBridge();
        process.env.PI_IMAGES_MODE = "placeholder";
        process.env.TEST_PASSTHROUGH = "on";
        const placeholder = acquireBridge();
        assert.equal(legacyUninstalls, 2);
        assert.equal(placeholder.mode, "kitty-placeholder");
        sixel.release();
        placeholder.release();
      },
    );
  } finally {
    delete globals[legacySymbol];
    delete globals[bridgeSymbol];
    rmSync(directory, { recursive: true });
  }
});

test("formats inactive and active bridge status", () => {
  assert.equal(
    formatBridgeStatus({ active: false, reason: "disabled", release: () => {} }),
    "pi-images: inactive (disabled)",
  );

  const status = formatBridgeStatus({
    active: true,
    reason: "ready",
    mode: "sixel",
    stats: {
      transmissions: 1,
      placements: 2,
      cacheHits: 3,
      cacheMisses: 4,
      conversionFailures: 5,
      droppedBytes: 6,
      sourceImages: 7,
      cachedRenders: 8,
      cachedRenderBytes: 2048,
    },
    release: () => {},
  });
  assert.match(status, /pi-images: active \(ready\)/);
  assert.match(status, /cache: 3 hits \/ 4 misses/);
  assert.match(status, /render cache: 8 entries \/ 2 KiB/);
  assert.match(status, /dropped input: 6 bytes/);
});
