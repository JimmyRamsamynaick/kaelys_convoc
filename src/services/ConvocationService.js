const { EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const Convocation = require("../models/Convocation");
const GuildConfigService = require("./GuildConfigService");
const ModLogService = require("./ModLogService");
const PermissionService = require("./PermissionService");
const { EMBED_COLORS, CONVOC_STATUSES, formatDate } = require("../config");

function convocationButtons(convocId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("convoc:honor:" + String(convocId))
      .setLabel("✅ Marquer honorée")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("convoc:cancel:" + String(convocId))
      .setLabel("❌ Annuler la convocation")
      .setStyle(ButtonStyle.Secondary)
  );
  return row;
}

function decodeConvocButton(customId) {
  const m = String(customId || "").match(/^convoc:(honor|cancel):(.+)$/);
  if (!m) return null;
  return { action: m[1], convocationId: m[2] };
}

class ConvocationService {
  async validateBeforeSend({ client, guild, issuerMember, targetMember, reasonKey, customDetails }) {
    const errors = [];
    if (!guild) errors.push("Serveur Discord introuvable.");
    if (!client?.user) errors.push("Bot non connecté.");
    if (!issuerMember) errors.push("Émetteur introuvable.");
    const mod = await GuildConfigService.getModeration(guild?.id);
    if (!mod?.convocationChannelId) {
      return {
        ok: false,
        code: "CHANNEL_NOT_CONFIGURED",
        errors,
        message: "❌ Le salon des convocations n'est pas configuré."
      };
    }
    const channel = await client.channels.fetch(mod.convocationChannelId).catch(() => null);
    if (!channel) {
      return {
        ok: false,
        code: "CHANNEL_NOT_FOUND",
        errors,
        message:
          "❌ Le salon configuré pour les convocations est introuvable.\nVeuillez vérifier la configuration du serveur."
      };
    }
    const botPerms = channel.permissionsFor?.(client.user);
    if (!botPerms?.has?.(PermissionFlagsBits.SendMessages)) {
      return {
        ok: false,
        code: "BOT_MISSING_PERMS",
        errors,
        message:
          "❌ Je n'ai pas les permissions nécessaires pour envoyer une convocation dans ce salon."
      };
    }
    if (!botPerms?.has?.(PermissionFlagsBits.EmbedLinks)) {
      return {
        ok: false,
        code: "BOT_MISSING_PERMS",
        errors,
        message:
          "❌ Je n'ai pas les permissions nécessaires pour envoyer des embeds dans ce salon."
      };
    }
    if (!botPerms?.has?.(PermissionFlagsBits.MentionEveryone)) {
      return {
        ok: false,
        code: "BOT_MISSING_PERMS",
        errors,
        message:
          "❌ Je ne peux pas mentionner le membre dans ce salon. Merci d'autoriser la mention @everyone/@here (le bot ne ping que le membre convoqué)."
      };
    }
    if (!targetMember?.user?.id || !targetMember.guild || targetMember.guild.id !== guild.id) {
      return {
        ok: false,
        code: "MEMBER_NOT_FOUND",
        errors,
        message:
          "❌ Le membre sélectionné est introuvable ou ne fait plus partie du serveur."
      };
    }
    if (targetMember.user.bot) {
      return {
        ok: false,
        code: "MEMBER_IS_BOT",
        errors,
        message: "❌ Impossible de convoquer un bot."
      };
    }
    const reasons = await GuildConfigService.getReasons(guild.id);
    const reason = reasons?.[reasonKey];
    if (!reason) {
      return {
        ok: false,
        code: "INVALID_REASON",
        errors,
        message: "❌ Type de convocation invalide."
      };
    }
    if (reasonKey === "autre" && (!customDetails || !String(customDetails).trim())) {
      return {
        ok: false,
        code: "DETAILS_REQUIRED",
        errors,
        message: "❌ Une description personnalisée est obligatoire pour la raison « Autre »."
      };
    }
    const canModerate = await PermissionService.isModerator(issuerMember, guild.id);
    if (!canModerate) {
      return {
        ok: false,
        code: "PERMISSION_DENIED",
        errors,
        message: "❌ Permission refusée."
      };
    }
    const exempt = await PermissionService.isExempt(targetMember, guild.id);
    if (exempt) {
      return {
        ok: false,
        code: "TARGET_EXEMPT",
        errors,
        message: "❌ Ce membre est protégé et ne peut pas être convoqué."
      };
    }
    if (issuerMember.id === targetMember.id) {
      return {
        ok: false,
        code: "SELF_CONVOC",
        errors,
        message: "❌ Vous ne pouvez pas vous auto-convoquer."
      };
    }
    return {
      ok: true,
      channel,
      mod,
      reason,
      reasonKey
    };
  }

  buildConvocEmbed({ targetMember, issuerMember, reason, reasonKey, customDetails, deadlineAt }) {
    const description = reasonKey === "autre" && customDetails ? customDetails : reason.message;
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.CONVOC)
      .setAuthor({ name: "📢 CONVOCATION" })
      .addFields(
        { name: "👤 Membre", value: `<@${targetMember.id}>`, inline: true },
        { name: "📋 Motif", value: String(reason.label), inline: true }
      )
      .setTimestamp();
    if (reason.requiredAction) embed.addFields({ name: "🎯 Action attendue", value: this._humanAction(reason.requiredAction), inline: false });
    embed.addFields({ name: "📝 Message", value: String(description).slice(0, 1024), inline: false });
    if (deadlineAt) {
      embed.addFields({ name: "⏰ Date limite", value: formatDate(deadlineAt), inline: true });
      if (reason?.sanctionIfExpired?.type && reason.sanctionIfExpired.type !== "none") {
        const s = reason.sanctionIfExpired;
        const pretty = this._humanSanction(s);
        embed.addFields({ name: "⚠️  Sanction en cas de non-respect", value: pretty, inline: true });
      }
    }
    const reminders = reason?.reminderOffsetsMs?.length ? reason.reminderOffsetsMs : [];
    if (reminders.length) {
      embed.addFields({
        name: "🔔 Rappels programmés",
        value: reminders
          .sort((a, b) => b - a)
          .map((ms) => {
            const when = new Date(deadlineAt.getTime() - ms);
            return `• ${this._humanOffset(ms)} avant le délai (${formatDate(when)})`;
          })
          .join("\n"),
        inline: false
      });
    }
    embed.addFields({
      name: "\u200B",
      value: "Merci de vous rendre disponible rapidement.",
      inline: false
    });
    embed.addFields({ name: "👮 Convocation effectuée par", value: `<@${issuerMember.id}>`, inline: false });
    embed.setFooter({ text: "Kaelys Convoc · Système de modération" });
    return { embed, description };
  }

  buildConfirmationEmbed({ targetMember, reason, channel, deadlineAt }) {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.SUCCESS)
      .setTitle("✅ Convocation envoyée")
      .addFields(
        { name: "👤 Membre", value: `<@${targetMember.id}>`, inline: true },
        { name: "📋 Motif", value: String(reason.label), inline: true },
        { name: "📍 Salon", value: `${channel}`, inline: false }
      );
    if (deadlineAt) embed.addFields({ name: "⏰ Date limite", value: formatDate(deadlineAt), inline: false });
    return embed;
  }

  async send({ client, interaction, issuerMember, targetMember, reasonKey, customDetails }) {
    const guild = interaction.guild;
    const validation = await this.validateBeforeSend({
      client,
      guild,
      issuerMember,
      targetMember,
      reasonKey,
      customDetails
    });
    if (!validation.ok) return validation;
    const { channel, reason } = validation;
    const now = new Date();
    const deadlineAt = reason.deadlineMs ? new Date(now.getTime() + reason.deadlineMs) : null;
    const { embed, description } = this.buildConvocEmbed({
      targetMember,
      issuerMember,
      reason,
      reasonKey,
      customDetails,
      deadlineAt
    });
    let sent;
    try {
      sent = await channel.send({
        content: `<@${targetMember.id}>`,
        embeds: [embed],
        allowedMentions: { users: [targetMember.id], roles: [], parse: [] }
      });
    } catch (err) {
      return {
        ok: false,
        code: "SEND_FAILED",
        message: "❌ Impossible d'envoyer la convocation : " + err.message
      };
    }
    const convocation = await Convocation.create({
      guildId: guild.id,
      userId: targetMember.id,
      reasonKey,
      reasonLabel: reason.label,
      customDetails: customDetails || null,
      requiredAction: reason.requiredAction || "custom",
      messageSent: description,
      createdAt: now,
      deadlineAt,
      reminderTimestamps: [],
      status: CONVOC_STATUSES.PENDING,
      sanctionIfExpired: reason.sanctionIfExpired
        ? {
            type: reason.sanctionIfExpired.type || "none",
            durationMs: reason.sanctionIfExpired.durationMs || null,
            reason: reason.sanctionIfExpired.reason || "Convocation non respectée."
          }
        : null,
      channelId: channel.id,
      messageId: sent.id,
      issuerId: issuerMember.id
    });

    try {
      const row = convocationButtons(convocation._id);
      await sent.edit({ components: [row] }).catch(() => null);
    } catch (_) {}
    await ModLogService.write(client, {
      guildId: guild.id,
      type: "convocation.created",
      targetUser: targetMember.user,
      issuer: issuerMember.user,
      channelId: channel.id,
      messageId: sent.id,
      convocationId: convocation._id,
      details: {
        reasonKey,
        reasonLabel: reason.label,
        customDetails: customDetails || null,
        requiredAction: reason.requiredAction || "custom",
        deadlineAt: deadlineAt || null,
        message: description,
        sanctionIfExpired: reason.sanctionIfExpired || null
      }
    });
    return {
      ok: true,
      convocation,
      message: sent,
      confirmationEmbed: this.buildConfirmationEmbed({
        targetMember,
        reason,
        channel,
        deadlineAt
      })
    };
  }

  async listReasons(guildId) {
    return GuildConfigService.getReasons(guildId);
  }

  async reasonChoices(guildId) {
    const reasons = await this.listReasons(guildId);
    return Object.entries(reasons || {})
      .map(([key, r]) => ({ name: r.label || key, value: key }))
      .slice(0, 25);
  }

  _humanAction(action) {
    switch (action) {
      case "open_ticket": return "Ouvrir un ticket auprès de l'équipe.";
      case "contact_staff": return "Contacter un membre de l'équipe de modération.";
      case "join_voice": return "Rejoindre le salon vocal de modération.";
      case "reply_in_channel": return "Répondre dans le salon des convocations.";
      case "custom": return "Action personnalisée (détaillée dans le message).";
      default: return String(action);
    }
  }

  _humanSanction(s) {
    const reason = s.reason ? ` — motif : ${s.reason}` : "";
    const duration = s.durationMs ? ` pour ${this._humanOffset(s.durationMs)}` : "";
    switch (s.type) {
      case "ban": return `Bannissement${duration}${reason}`;
      case "kick": return `Exclusion${reason}`;
      case "mute":
      case "timeout": return `Rendez-vous muet${duration || " défini" }${reason}`;
      case "warn": return `Avertissement enregistré${reason}`;
      default: return "Aucune";
    }
  }

  _humanOffset(ms) {
    if (ms == null) return "indéfini";
    const sec = Math.max(1, Math.round(ms / 1000));
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const parts = [];
    if (days) parts.push(`${days}j`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}min`);
    if (!parts.length) parts.push(`${sec}s`);
    return parts.join(" ");
  }

  async cancelConvocation({ convocationId, client, actorId, reasonNote = "Annulée manuellement" }) {
    const ConvocationModel = Convocation;
    const updated = await ConvocationModel.findOneAndUpdate(
      { _id: convocationId, status: CONVOC_STATUSES.PENDING },
      { $set: { status: CONVOC_STATUSES.CANCELLED, cancelledAt: new Date(), cancelledBy: actorId, cancellationNote: reasonNote } },
      { new: true, runValidators: true }
    ).lean();
    if (!updated) return null;
    await ModLogService.write(client, {
      guildId: updated.guildId,
      type: "convocation.cancelled",
      targetUserId: updated.userId,
      issuerId: actorId,
      convocationId: updated._id,
      channelId: updated.channelId,
      details: {
        reasonKey: updated.reasonKey,
        reasonLabel: updated.reasonLabel,
        requiredAction: updated.requiredAction,
        note: reasonNote
      }
    });
    try {
      const ch = await client.channels.fetch(updated.channelId).catch(() => null);
      if (ch?.isTextBased?.() && updated.messageId) {
        const msg = await ch.messages.fetch(updated.messageId).catch(() => null);
        if (msg?.editable) {
          const e = EmbedBuilder.from(msg.embeds[0])
            .spliceFields(0, 999, ...(msg.embeds[0]?.fields?.map((f) => ({ name: f.name, value: f.value, inline: !!f.inline })) || []))
            .setColor(EMBED_COLORS.WARNING)
            .setTitle("📢 CONVOCATION — ❌ ANNULEE");
          await msg.edit({ embeds: [e], components: [] }).catch(() => null);
        }
      }
    } catch (_) {}
    return updated;
  }

  async honorConvocation({ convocationId, client, actorId, note = "Clic bouton admin" }) {
    const TicketIntegration = require("./TicketIntegration");
    const c = await Convocation.findById(convocationId).lean();
    if (!c) return { ok: false, code: "NOT_FOUND" };
    const done = await TicketIntegration.markPendingConvocationCompleted({
      guildId: c.guildId,
      userId: c.userId,
      requiredAction: null,
      convocationId: c._id,
      client,
      completedVia: `button:honor·${note}`.slice(0, 200),
      actorId
    });
    if (!done.length) return { ok: false, code: "NOT_PENDING", currentStatus: c.status };
    try {
      const ch = await client.channels.fetch(c.channelId).catch(() => null);
      if (ch?.isTextBased?.() && c.messageId) {
        const msg = await ch.messages.fetch(c.messageId).catch(() => null);
        if (msg?.editable) await msg.edit({ components: [] }).catch(() => null);
      }
    } catch (_) {}
    return { ok: true, convocation: done[0] };
  }
}

module.exports = new ConvocationService();
module.exports.convocationButtons = convocationButtons;
module.exports.decodeConvocButton = decodeConvocButton;
