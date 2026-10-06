const { EmbedBuilder } = require("discord.js");
const ModLog = require("../models/ModLog");
const GuildConfigService = require("./GuildConfigService");
const { EMBED_COLORS, formatDate } = require("../config");

class ModLogService {
  async write(client, { guildId, type, targetUser = null, issuer = null, channelId = null, messageId = null, convocationId = null, details = {} }) {
    try {
      const log = await ModLog.create({
        guildId,
        type,
        targetUserId: targetUser?.id || null,
        targetUserTag: targetUser?.tag || null,
        issuerId: issuer?.id || null,
        issuerTag: issuer?.tag || null,
        channelId,
        messageId,
        convocationId,
        details
      });
      await this._dispatchEmbed(client, log);
      return log;
    } catch (err) {
      console.error("❌ ModLogService.write a échoué :", err.message);
      throw err;
    }
  }

  async _dispatchEmbed(client, log) {
    try {
      const cfg = await GuildConfigService.getModeration(log.guildId);
      const logsChannelId = cfg?.logsChannelId || null;
      const convocationChannelId = cfg?.convocationChannelId || null;

      const candidates = [];
      if (logsChannelId) {
        candidates.push(logsChannelId);
      } else {
        if (convocationChannelId) candidates.push(convocationChannelId);
        if (log?.channelId && log.channelId !== convocationChannelId) candidates.push(log.channelId);
        if (log?.details?.channelId && !candidates.includes(log.details.channelId)) candidates.push(log.details.channelId);
      }

      const uniq = [...new Set(candidates.filter(Boolean))];
      let hasWarnedNoLogs = false;

      for (const channelId of uniq) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased?.()) continue;
        const perms = channel.permissionsFor?.(client.user);
        if (!perms?.has?.("SendMessages")) continue;
        if (!logsChannelId && !hasWarnedNoLogs) {
          const { EMBED_COLORS } = require("../config");
          const warnEmbed = {
            color: EMBED_COLORS.WARNING,
            title: "ℹ️  Salon de logs non configuré",
            description:
              "Ce message de log est envoyé ici car aucun salon de logs n'a été défini.\n" +
              "Pour éviter de polluer le salon des convocations : exécute `/config logs-channel #ton-salon-de-logs`.\n" +
              "Le log ci-dessous aurait dû être envoyé dans le salon de logs.",
            timestamp: new Date()
          };
          await channel.send({ embeds: [warnEmbed], allowedMentions: { users: [], roles: [], parse: [] } }).catch(() => null);
          hasWarnedNoLogs = true;
        }
        const embed = new EmbedBuilder()
          .setColor(this._colorFor(log.type))
          .setTitle(this._titleFor(log.type))
          .setTimestamp(log.createdAt)
          .setFooter({ text: `Kaelys Convoc · ID log ${log._id}` });
        const fields = [];
        if (log.targetUserId) {
          fields.push({ name: "👤 Membre", value: `<@${log.targetUserId}>`, inline: true });
          fields.push({ name: "🆔 User ID", value: `\`${log.targetUserId}\``, inline: true });
        }
        if (log.issuerId) fields.push({ name: "👮 Modérateur / Auteur", value: `<@${log.issuerId}>`, inline: false });
        if (log.details?.reasonLabel) fields.push({ name: "📋 Motif", value: String(log.details.reasonLabel), inline: false });
        if (log.details?.reasonKey) fields.push({ name: "🔑 Clé raison", value: String(log.details.reasonKey), inline: true });
        if (log.details?.requiredAction) fields.push({ name: "🎯 Action requise", value: String(log.details.requiredAction), inline: true });
        if (log.details?.completedVia) fields.push({ name: "🎟️ Résolue via", value: String(log.details.completedVia).slice(0, 1024), inline: false });
        if (log.details?.reason) fields.push({ name: "📝 Détails", value: String(log.details.reason).slice(0, 1024), inline: false });
        if (log.details?.deadlineAt) fields.push({ name: "⏰ Date limite", value: formatDate(log.details.deadlineAt), inline: true });
        if (log.details?.completedAt) fields.push({ name: "✅ Complétée le", value: formatDate(log.details.completedAt), inline: true });
        if (log.details?.sanction) fields.push({ name: "⚠️  Sanction", value: String(log.details.sanction), inline: true });
        if (log.convocationId) fields.push({ name: "🆔 Convocation", value: `\`${log.convocationId}\``, inline: false });
        if (log.channelId) fields.push({ name: "📍 Salon", value: `<#${log.channelId}>`, inline: true });
        if (log.details?.failureReason) fields.push({ name: "🚨 Échec", value: String(log.details.failureReason).slice(0, 1024), inline: false });
        if (fields.length) embed.addFields(fields);
        await channel.send({ embeds: [embed], allowedMentions: { users: [], roles: [], parse: [] } }).catch(() => null);
      }
    } catch (err) {
      console.warn("⚠️  ModLogService._dispatchEmbed échec envoi :", err.message);
    }
  }

  _titleFor(type) {
    switch (type) {
      case "convocation.created": return "📢 Convocation effectuée";
      case "convocation.completed": return "✅ Convocation honorée";
      case "convocation.expired": return "⏱️ Convocation expirée";
      case "convocation.sanctioned": return "⚖️  Sanction automatique appliquée";
      case "convocation.cancelled": return "⛔ Convocation annulée";
      case "convocation.reminder": return "🔔 Rappel de convocation";
      case "convocation.sanction_failed": return "🚨 Échec sanction automatique";
      case "guild_config.updated": return "⚙️  Configuration serveur mise à jour";
      case "sanction.ban": return "🔨 Bannissement appliqué";
      case "sanction.kick": return "👢 Exclusion appliquée";
      case "sanction.mute": return "🔇 Rendez-vous muet appliqué";
      case "sanction.warn": return "⚠️  Avertissement enregistré";
      default: return `📝 ${type}`;
    }
  }

  _colorFor(type) {
    if (type.includes("sanction") || type.includes("failed") || type.includes("expired") || type.includes("cancelled")) return EMBED_COLORS.DANGER;
    if (type.includes("reminder")) return EMBED_COLORS.WARNING;
    if (type.includes("completed") || type.includes("created")) return EMBED_COLORS.SUCCESS;
    if (type.includes("config")) return EMBED_COLORS.INFO;
    return EMBED_COLORS.CONVOC;
  }
}

module.exports = new ModLogService();
