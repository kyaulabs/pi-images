import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { acquireBridge, formatBridgeStatus } from "./runtime.js";

export default function piImages(pi: ExtensionAPI): void {
  const bridge = acquireBridge();
  const showStatus = async (_args: string, context: ExtensionCommandContext) => {
    context.ui.notify(formatBridgeStatus(bridge), bridge.active ? "info" : "warning");
  };

  pi.registerCommand("images-status", {
    description: "Show the tmux image bridge mode and runtime statistics",
    handler: showStatus,
  });

  pi.registerCommand("sixel-status", {
    description: "Alias for /images-status",
    handler: showStatus,
  });

  pi.on("session_shutdown", async () => {
    bridge.release();
  });
}
