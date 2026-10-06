const GuildConfigService = require("../services/GuildConfigService");
const TicketIntegration = require("../services/TicketIntegration");
const ModLogService = require("../services/ModLogService");

module.exports = {
  name: "threadCreate",
  async execute(client, thread, newlyCreated) {
    try {
      const guildId = thread.guild?.id;
      if (!guildId) return;
      const cfg = await GuildConfigService.getOrCreate(guildId);
      const ticketsCategoryId = cfg?.moderation?.ticketsCategoryId || null;
      const ticketsChannelId = cfg?.moderation?.ticketsChannelId || null;

      if (!ticketsCategoryId && !ticketsChannelId) {
        console.log(
          `🟠 threadCreate NOT_CONFIGURED guild=${guildId} thread=${thread.id}(${thread.name}) parent=${thread.parentId || "none"} — run /config tickets-category categorie:...`
        );
        return;
      }

      if (!TicketIntegration.looksLikeTicketChannel(thread, ticketsChannelId, ticketsCategoryId)) {
        return;
      }

      if (thread.joinable && !thread.joined) {
        await thread.join?.().catch(() => null);
      }

      const r = await TicketIntegration.resolveChannelTicketForAllUsers({ client, channel: thread }).catch(() => null);
      if (!r) return;

      try {
        await ModLogService.write(client, {
          guildId,
          type: r.matched ? "convocation.completed" : "ticket.thread_create_detected",
          issuerId: client.user.id,
          targetUserId: r.userIds?.[0] || null,
          details: {
            threadId: thread.id,
            threadName: thread.name,
            parentId: thread.parentId,
            userIds: r.userIds,
            matched: r.matched,
            completedIds: (r.completed || []).map((c) => String(c._id || c.id)).slice(0, 20)
          }
        }).catch(() => null);
      } catch (_) {}

      console.log(
        `🟠 threadCreate ticket guild=${guildId} thread=${thread.id}(${thread.name}) parent=${thread.parentId || "none"} candidates=${
          r.userIds?.length || 0
        } matched=${r.matched ? "YES" : "NO"} completed=${r.completed?.length || 0}`
      );
    } catch (e) {
      console.error(`[event/threadCreate] error:`, e?.stack || e?.message || e);
    }
  }
};
