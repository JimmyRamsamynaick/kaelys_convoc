const TicketIntegration = require("../services/TicketIntegration");
const ModLogService = require("../services/ModLogService");

module.exports = {
  name: "voiceStateUpdate",
  once: false,
  async execute(client, oldState, newState) {
    try {
      if (!newState?.channelId || oldState?.channelId === newState.channelId) return;
      const userId = newState.id;
      const guildId = newState.guild?.id;
      if (!guildId || !userId) return;
      const completed = await TicketIntegration.markPendingConvocationCompleted({
        guildId,
        userId,
        requiredAction: "join_voice",
        client,
        completedVia: `voice-join·<#${newState.channelId}>`,
        actorId: userId
      });
      for (const c of completed) {
        await ModLogService.write(client, {
          guildId,
          type: "convocation.completed",
          targetUserId: userId,
          issuerId: c.issuerId || null,
          convocationId: c._id,
          channelId: c.channelId,
          details: {
            reasonLabel: c.reasonLabel,
            requiredAction: c.requiredAction,
            resolverId: userId
          }
        });
      }
    } catch (err) {
      console.warn("⚠️  voiceStateUpdate hook error:", err.message);
    }
  }
};
