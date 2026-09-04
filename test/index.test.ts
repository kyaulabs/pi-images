import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import piImages from "../src/index.js";

type StatusCommand = {
  handler: (args: string, context: ExtensionCommandContext) => Promise<void>;
};

test("registers status commands and releases on shutdown", async () => {
  const commands = new Map<string, StatusCommand>();
  let shutdown: (() => void) | undefined;
  const notifications: Array<[string, string]> = [];
  const previousEnabled = process.env.PI_IMAGES;
  process.env.PI_IMAGES = "off";

  const pi = {
    registerCommand: (name: string, command: StatusCommand) => {
      commands.set(name, command);
    },
    on: (event: string, listener: () => void) => {
      assert.equal(event, "session_shutdown");
      shutdown = listener;
    },
  } as unknown as ExtensionAPI;
  const context = {
    ui: {
      notify: (message: string, level: string) => notifications.push([message, level]),
    },
  } as unknown as ExtensionCommandContext;

  try {
    piImages(pi);
    assert.deepEqual([...commands.keys()], ["images-status", "sixel-status"]);
    await commands.get("images-status")!.handler("", context);
    await commands.get("sixel-status")!.handler("", context);
    assert.deepEqual(notifications, [
      ["pi-images: inactive (disabled by PI_IMAGES)", "warning"],
      ["pi-images: inactive (disabled by PI_IMAGES)", "warning"],
    ]);
    assert.ok(shutdown);
    shutdown();
  } finally {
    if (previousEnabled === undefined) delete process.env.PI_IMAGES;
    else process.env.PI_IMAGES = previousEnabled;
  }
});

test("reports active bridge status as information", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-images-index-"));
  const tmux = join(directory, "tmux");
  writeFileSync(
    tmux,
    "#!/bin/sh\nif [ \"$1\" = display-message ]; then echo '1|extkeys|xterm-ghostty'; else echo on; fi\n",
  );
  chmodSync(tmux, 0o755);

  const savedPath = process.env.PATH;
  const savedTmux = process.env.TMUX;
  const savedMode = process.env.PI_IMAGES_MODE;
  const savedProtocol = process.env.PI_IMAGE_PROTOCOL;
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const actualWrite = process.stdout.write;
  const commands = new Map<string, StatusCommand>();
  let shutdown: (() => void) | undefined;
  let notification: [string, string] | undefined;

  process.env.PATH = `${directory}:${savedPath ?? ""}`;
  process.env.TMUX = "test";
  delete process.env.PI_IMAGES_MODE;
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
  process.stdout.write = () => true;

  const pi = {
    registerCommand: (name: string, command: StatusCommand) => commands.set(name, command),
    on: (_event: string, listener: () => void) => (shutdown = listener),
  } as unknown as ExtensionAPI;
  const context = {
    ui: {
      notify: (message: string, level: string) => (notification = [message, level]),
    },
  } as unknown as ExtensionCommandContext;

  try {
    piImages(pi);
    await commands.get("images-status")!.handler("", context);
    assert.equal(notification?.[1], "info");
    assert.match(notification?.[0] ?? "", /mode: kitty-placeholder/);
    shutdown?.();
  } finally {
    process.stdout.write = actualWrite;
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    if (savedTmux === undefined) delete process.env.TMUX;
    else process.env.TMUX = savedTmux;
    if (savedMode === undefined) delete process.env.PI_IMAGES_MODE;
    else process.env.PI_IMAGES_MODE = savedMode;
    if (savedProtocol === undefined) delete process.env.PI_IMAGE_PROTOCOL;
    else process.env.PI_IMAGE_PROTOCOL = savedProtocol;
    if (ttyDescriptor) Object.defineProperty(process.stdout, "isTTY", ttyDescriptor);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    rmSync(directory, { recursive: true });
  }
});
