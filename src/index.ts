import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { acquireBridge, formatBridgeStatus } from "./runtime.js";

export default function piSixel(pi: ExtensionAPI): void {
  const bridge = acquireBridge();

  pi.registerCommand("sixel-status", {
    description: "Show Pi SIXEL bridge status and conversion statistics",
    handler: async (_args, context) => {
      context.ui.notify(formatBridgeStatus(bridge), bridge.active ? "info" : "warning");
    },
  });

  pi.on("session_shutdown", async () => {
    bridge.release();
  });
}
