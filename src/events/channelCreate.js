const GuildConfigService = require("../services/GuildConfigService");
const TicketIntegration = require("../services/TicketIntegration");
const ModLogService = require("../services/ModLogService");

module.exports = {
  name: "channelCreate",
  async execute(client, channel) {
    try {
      const guildId = channel.guild?.id;
      if (!guildId) return;
      const type = channel.type;
      const interesting = type === 0 || type === 11 || type === 12 || type === 15 || type === 10 || type === 5 || type === 16 || type === 14;
      if (!interesting) {
        console.log(`🟠 channelCreate SKIP (type non intéressant) guild=${guildId} channel=${channel.id} type=${type}`);
        return;
      }

      const cfg = await GuildConfigService.getOrCreate(guildId);
      const ticketsCategoryId = cfg?.moderation?.ticketsCategoryId || null;
      const ticketsChannelId = cfg?.moderation?.ticketsChannelId || null;

      if (!ticketsCategoryId && !ticketsChannelId) {
        console.log(
          `🟠 channelCreate NOT_CONFIGURED guild=${guildId} channel=${channel.id}(${channel.name}) parent=${channel.parentId || "none"} — run /config tickets-category categorie:...`
        );
        try {
          await ModLogService.write(client, {
            guildId,
            type: "ticket.create_not_configured",
            issuerId: client.user.id,
            details: {
              channelId: channel.id,
              channelName: channel.name,
              parentId: channel.parentId,
              why: "Aucun ticketsCategoryId / ticketsChannelId configuré → exécute /config tickets-category"
            }
          }).catch(() => null);
        } catch (_) {}
        // FALLBACK quand même : on tente de résoudre si ça ressemble à un ticket par heuristique nom, comme ça on est safe.
        const looksFallback = /ticket|tickets|verif|verification|support|aide|help|demande|contact|verification/i.test(
          (channel.name || "") + " " + (channels?.get?.(channel.parentId)?.name || "")
        );
        if (looksFallback) {
          try {
            const r2 = await TicketIntegration.resolveChannelTicketForAllUsers({ client, channel }).catch(() => null);
            if (r2?.matched) console.log("🟠 channelCreate fallback-no-config matched YES for " + channel.id);
          } catch (_) {}
        }
        return;
      }

      if (!TicketIntegration.looksLikeTicketChannel(channel, ticketsChannelId, ticketsCategoryId)) {
        console.log(
          `🟠 channelCreate NOT_TICKET_CHANNEL guild=${guildId} channel=${channel.id}(${channel.name}) parent=${channel.parentId || "none"} category_cfg=${ticketsCategoryId || "none"} ticketsChannel_cfg=${ticketsChannelId || "none"}`
        );
        return;
      }

      // Vérification permissions sur le channel
      try {
        const perms = channel.permissionsFor?.(client.user);
        const view = perms?.has?.(1024n) || false;
        const readHist = perms?.has?.(65536n) || false;
        if (!view || !readHist) {
          console.log(
            `🟠 channelCreate MISSING_PERMS guild=${guildId} channel=${channel.id}(${channel.name}) ViewChannel=${view} ReadHistory=${readHist}`
          );
          try {
            await ModLogService.write(client, {
              guildId,
              type: "ticket.create_missing_perms",
              issuerId: client.user.id,
              details: {
                channelId: channel.id,
                channelName: channel.name,
                parentId: channel.parentId,
                ViewChannel: view,
                ReadMessageHistory: readHist,
                why: "Ajoutez les permissions Voir le salon + Lire l'historique des messages au bot sur ce salon / catégorie."
              }
            }).catch(() => null);
          } catch (_) {}
        }
      } catch (_) {}

      const r = await TicketIntegration.resolveChannelTicketForAllUsers({ client, channel }).catch(() => null);
      if (!r) return;

      console.log(
        `🟠 channelCreate ticket-detect guild=${guildId} channel=${channel.id}(${channel.name}) category=${channel.parentId || "none"} candidates=${
          r.userIds?.length || 0
        } matched=${r.matched ? "YES" : "NO"} completed=${r.completed?.length || 0}`
      );

      try {
        await ModLogService.write(client, {
          guildId,
          type: r.matched ? "convocation.completed" : "ticket.channel_create_detected",
          issuerId: client.user.id,
          targetUserId: r.userIds?.[0] || null,
          details: {
            channelId: channel.id,
            channelName: channel.name,
            categoryId: channel.parentId,
            userIds: r.userIds,
            matched: r.matched,
            completedIds: (r.completed || []).map((c) => String(c._id || c.id)).slice(0, 20)
          }
        }).catch(() => null);
      } catch (_) {}
    } catch (e) {
      console.error(`[event/channelCreate] error:`, e?.stack || e?.message || e);
    }
  }
};
