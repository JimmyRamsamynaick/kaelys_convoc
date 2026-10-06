const GuildConfigService = require("../services/GuildConfigService");
const TicketIntegration = require("../services/TicketIntegration");
const ModLogService = require("../services/ModLogService");

module.exports = {
  name: "channelUpdate",
  async execute(client, oldChannel, newChannel) {
    try {
      const guildId = newChannel?.guild?.id || oldChannel?.guild?.id;
      if (!guildId) return;
      const oldParentId = oldChannel?.parentId;
      const newParentId = newChannel?.parentId;
      if (oldParentId === newParentId) return;

      const cfg = await GuildConfigService.getOrCreate(guildId);
      const ticketsCategoryId = cfg?.moderation?.ticketsCategoryId || null;
      const ticketsChannelId = cfg?.moderation?.ticketsChannelId || null;

      if (!ticketsCategoryId && !ticketsChannelId) {
        console.log(
          `🟠 channelUpdate NOT_CONFIGURED guild=${guildId} channel=${newChannel.id}(${newChannel.name}) ${oldParentId || "none"} → ${
            newParentId || "none"
          }`
        );
        return;
      }

      if (!TicketIntegration.looksLikeTicketChannel(newChannel, ticketsChannelId, ticketsCategoryId)) {
        return;
      }

      const r = await TicketIntegration.resolveChannelTicketForAllUsers({ client, channel: newChannel }).catch(() => null);
      if (!r) return;

      try {
        await ModLogService.write(client, {
          guildId,
          type: r.matched ? "convocation.completed" : "ticket.channel_moved_detected",
          issuerId: client.user.id,
          targetUserId: r.userIds?.[0] || null,
          details: {
            channelId: newChannel.id,
            channelName: newChannel.name,
            oldParentId,
            newParentId,
            userIds: r.userIds,
            matched: r.matched,
            completedIds: (r.completed || []).map((c) => String(c._id || c.id)).slice(0, 20)
          }
        }).catch(() => null);
      } catch (_) {}

      console.log(
        `🟠 channelUpdate moved ticket guild=${guildId} channel=${newChannel.id}(${newChannel.name}) ${oldParentId || "none"} → ${
          newParentId || "none"
        } candidates=${r.userIds?.length || 0} matched=${r.matched ? "YES" : "NO"} completed=${r.completed?.length || 0}`
      );
    } catch (e) {
      console.error(`[event/channelUpdate] error:`, e?.stack || e?.message || e);
    }
  }
};
