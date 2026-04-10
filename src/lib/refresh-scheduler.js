export class BlocklistRefreshScheduler {
  constructor(blocklistService, pollIntervalMs = 60_000) {
    this.blocklistService = blocklistService;
    this.pollIntervalMs = pollIntervalMs;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.error("[unifi_bl] scheduler error", error);
      });
    }, this.pollIntervalMs);

    this.timer.unref?.();

    this.tick().catch((error) => {
      console.error("[unifi_bl] scheduler bootstrap error", error);
    });
  }

  stop() {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const dueBlocklists = await this.blocklistService.listDueAutoRefresh();

      for (const blocklist of dueBlocklists) {
        try {
          await this.blocklistService.syncOne(blocklist.id, {
            origin: "scheduler",
          });
        } catch (error) {
          console.error(
            `[unifi_bl] auto-refresh failed for ${blocklist.name}`,
            error,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
