module.exports = {
  name: "messageCreate",
  once: false,
  async execute(client, message) {
    if (!message?.guildId) return;
    if (message.author?.id === client.user?.id) return;

    const guild = message.guild;
    const channelId = message.channelId;

    try {
      const PermissionService = require("../services/PermissionService");
      const TicketIntegration = require("../services/TicketIntegration");
      const ModLogService = require("../services/ModLogService");
      const GuildConfigService = require("../services/GuildConfigService");
      const { extractUserIdsFromMessage } = require("../services/TicketIntegration");
      const mod = await GuildConfigService.getModeration(message.guildId);

      const ticketChannelCandidate = TicketIntegration.looksLikeTicketChannel(
        message.channel,
        mod.ticketsChannelId
      );

      if (ticketChannelCandidate) {
        const candidates = extractUserIdsFromMessage(message);
        try {
          const allowContent = !!mod.ticketsChannelId;
          await ModLogService.write(client, {
            guildId: message.guildId,
            type: "ticket.debug_message_seen",
            issuerId: message.author?.id,
            targetUserId: candidates[0] || null,
            channelId,
            details: {
              messageId: message.id,
              messageChannelName: message.channel?.name || null,
              authorTag: message.author?.tag || null,
              authorBot: !!message.author?.bot,
              candidateUserIds: candidates,
              ticketsChannelId: mod.ticketsChannelId || null,
              heuristicMatched: ticketChannelCandidate,
              messageContent: allowContent
                ? String(message.content || "").slice(0, 600)
                : "[masqué : ticketsChannelId pas configuré]",
              embedCount: (message.embeds || []).length
            }
          });
        } catch (_) {}
      }

      if (message.reference?.channelId && message.reference?.messageId) {
        const Convocation = require("../models/Convocation");
        const refConv = await Convocation.findOne({
          guildId: message.guildId,
          messageId: message.reference.messageId,
          channelId: message.reference.channelId,
          status: { $in: ["pending"] },
          requiredAction: "reply_in_channel"
        }).lean();
        if (refConv) {
          await TicketIntegration.markPendingConvocationCompleted({
            guildId: message.guildId,
            userId: refConv.userId,
            requiredAction: "reply_in_channel",
            client,
            completedVia: `reply_in_channel·<@${message.author.id}>·<#${channelId}>/messages/${message.id}`,
            actorId: message.author.id,
            convocationId: refConv._id
          });
        }
      }

      if (ticketChannelCandidate) {
        const ticketMatches = await TicketIntegration.scanTicketMessage({
          client,
          message
        }).catch(() => null);
        if (ticketMatches?.length) {
          for (const m of ticketMatches) {
            for (const c of m.convocations || []) {
              try {
                await ModLogService.write(client, {
                  guildId: message.guildId,
                  type: "convocation.completed",
                  targetUserId: m.userId,
                  issuerId: c.issuerId || null,
                  convocationId: c._id,
                  channelId: message.channelId,
                  details: {
                    reasonLabel: c.reasonLabel,
                    reasonKey: c.reasonKey,
                    requiredAction: c.requiredAction,
                    resolverId: m.userId,
                    detector: m.detector,
                    triggeredBy: `message:${message.id}`,
                    channelId: c.channelId || message.channelId
                  }
                });
              } catch (_) {}
            }
          }
        } else {
          const cand = extractUserIdsFromMessage(message);
          if (cand.length) {
            try {
              await ModLogService.write(client, {
                guildId: message.guildId,
                type: "ticket.detected_no_pending",
                targetUserId: cand[0],
                issuerId: message.author?.id || null,
                channelId: message.channelId,
                details: {
                  messageId: message.id,
                  candidates: cand,
                  note: "Aucune convocation open_ticket en attente pour ces IDs. Si une convocation existe, vérifiez son statut (pas pending ?)."
                }
              });
            } catch (_) {}
          }
        }
      }

      const isStaff = await PermissionService.isModerator(message.member, message.guildId);
      if (isStaff && (message.mentions?.repliedUser || message.mentions?.users?.size)) {
        const targets = [];
        if (message.mentions?.repliedUser) targets.push(message.mentions.repliedUser.id);
        for (const [uid] of message.mentions?.users?.entries?.() || [])
          if (!targets.includes(uid)) targets.push(uid);
        for (const uid of targets) {
          const target = await guild.members.fetch(uid).catch(() => null);
          if (!target) continue;
          const completed = await TicketIntegration.markPendingConvocationCompleted({
            guildId: message.guildId,
            userId: target.id,
            requiredAction: "contact_staff",
            client,
            completedVia: `staff-mention·<@${message.author.id}>·<#${channelId}>`,
            actorId: message.author.id
          });
          for (const c of completed) {
            await ModLogService.write(client, {
              guildId: message.guildId,
              type: "convocation.completed",
              targetUser: target.user,
              issuer: message.author,
              convocationId: c._id,
              channelId,
              details: {
                reasonLabel: c.reasonLabel,
                requiredAction: c.requiredAction,
                resolverId: message.author.id
              }
            });
          }
        }
      }
    } catch (err) {
      console.warn("⚠️  messageCreate hook error:", err.message);
    }
  }
};
