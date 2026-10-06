const { CronJob } = require("cron");
const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const Convocation = require("../models/Convocation");
const { CONVOC_STATUSES, EMBED_COLORS, formatDate, ALLOWED_SANCTION_TYPES } = require("../config");
const ModLogService = require("./ModLogService");
const PermissionService = require("./PermissionService");
const TicketIntegration = require("./TicketIntegration");
const GuildConfigService = require("./GuildConfigService");

class ConvocationScheduler {
  constructor() {
    this.job = null;
    this.client = null;
    this.running = false;
  }

  attach(client) {
    this.client = client;
  }

  start() {
    if (this.job) return;
    this.job = new CronJob("*/30 * * * * *", () => this._tick().catch((err) => console.error("❌ ConvocationScheduler tick error:", err.message)), null, false, null, null, false);
    this.job.start();
    console.log("⏰ ConvocationScheduler démarré (toutes les 30s).");
  }

  stop() {
    if (this.job?.stop) this.job.stop();
    this.job = null;
  }

  async _tick() {
    if (!this.client?.isReady?.() || !this.client.guilds) return;
    if (this.running) return;
    this.running = true;
    try {
      await this._processPendingDeadlines();
      await this._scanTicketCategoriesPeriodically();
    } finally {
      this.running = false;
    }
  }

  async _scanTicketCategoriesPeriodically() {
    for (const [, guild] of this.client.guilds.cache) {
      try {
        const cfg = await GuildConfigService.getOrCreate(guild.id);
        const categoryId = cfg?.moderation?.ticketsCategoryId;
        let r = null;
        if (categoryId) {
          r = await TicketIntegration.autoResolveFromTicketCategory({
            client: this.client,
            guildId: guild.id,
            categoryId,
            maxChannels: 150,
            backfill: false
          }).catch(() => null);
          if (r?.resolved > 0) {
            console.log(
              `🔄 Scheduler scan-tickets-category guild=${guild.id} category=${categoryId} scanned=${r.scanned} resolved=${r.resolved}`
            );
          }
        }
        // Fallback ultime : cherche des convocations pending open_ticket même si category non settée (ou permissions ViewChannel insuffisantes).
        try {
          const guess = await TicketIntegration._resolvePendingOpenTicketsForGuildViaGuess({
            client: this.client,
            guildId: guild.id
          }).catch(() => null);
          if (guess?.found > 0 && guess?.resolved > 0) {
            console.log(
              `🔄 Scheduler fallback-guess guild=${guild.id} open_ticket_pending=${guess.found} resolved_via_fallback=${guess.resolved}`
            );
          } else if (guess?.found > 0 && guess?.resolved === 0 && !categoryId) {
            console.log(
              `⚠️  Scheduler pending_open_ticket_found guild=${guild.id} nb=${guess.found} — AUCUNE catégorie configurée. Exécute /config tickets-category categorie:#... OU donne les permissions ViewChannel + ReadMessageHistory sur la catégorie tickets.`
            );
          }
        } catch (_) {}
      } catch (_) {}
    }
  }

  async _processPendingDeadlines() {
    const now = new Date();
    const pending = await Convocation.find({
      status: CONVOC_STATUSES.PENDING,
      deadlineAt: { $lte: new Date(now.getTime() + 1000 * 60 * 60 * 24) }
    }).lean();
    for (const raw of pending) {
      const convocation = await Convocation.findById(raw._id);
      if (!convocation || convocation.status !== CONVOC_STATUSES.PENDING) continue;
      try {
        await this._processOne(convocation, now);
      } catch (err) {
        console.warn(`⚠️  Échec traitement convocation ${convocation._id}:`, err.message);
      }
    }
  }

  async _processOne(convocation, now) {
    if (!convocation.deadlineAt) return;
    const msLeft = convocation.deadlineAt.getTime() - now.getTime();
    const offsets = (convocation.sanctionIfExpired && Array.isArray(convocation.sanctionIfExpired.reminderOffsetsMs))
      ? convocation.sanctionIfExpired.reminderOffsetsMs
      : [];
    const offsetsActuallyUsed = Array.isArray(offsets) && offsets.length ? offsets : this._fallbackOffsets(convocation);
    for (const offset of offsetsActuallyUsed) {
      if (msLeft > 0 && msLeft <= offset) {
        const alreadySent = (convocation.reminderTimestamps || []).some((t) => {
          const sentMs = t instanceof Date ? t.getTime() : new Date(t).getTime();
          const expected = convocation.deadlineAt.getTime() - offset;
          return Math.abs(sentMs - expected) < 60 * 1000;
        });
        if (!alreadySent) {
          await this._sendReminder(convocation, offset, msLeft);
          convocation.reminderTimestamps.push(new Date());
          await convocation.save();
          return;
        }
      }
    }
    if (msLeft <= 0) {
      await this._processExpired(convocation);
    }
  }

  _fallbackOffsets(convocation) {
    const deadlineMs = convocation.deadlineAt.getTime() - (convocation.createdAt?.getTime?.() || Date.now());
    if (deadlineMs <= 0) return [];
    const out = [];
    const hour = 3600 * 1000;
    if (deadlineMs > hour * 24) out.push(12 * hour);
    if (deadlineMs > hour * 4) out.push(hour);
    if (deadlineMs > 30 * 60 * 1000) out.push(30 * 60 * 1000);
    return out;
  }

  async _sendReminder(convocation, offsetMs, msLeft) {
    const client = this.client;
    const guild = await client.guilds.fetch(convocation.guildId).catch(() => null);
    if (!guild) return;
    const channel = await client.channels.fetch(convocation.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    const member = await guild.members.fetch(convocation.userId).catch(() => null);
    if (!member) return;
    const perms = channel.permissionsFor?.(client.user);
    if (!perms?.has?.(PermissionFlagsBits.SendMessages)) return;
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.WARNING)
      .setTitle("🔔 Rappel de convocation")
      .addFields(
        { name: "👤 Membre", value: `<@${member.id}>`, inline: true },
        { name: "📋 Motif", value: String(convocation.reasonLabel), inline: true },
        { name: "⏰ Date limite", value: formatDate(convocation.deadlineAt), inline: false },
        { name: "⏳ Temps restant", value: this._humanOffset(msLeft), inline: true }
      )
      .setTimestamp();
    if (convocation.messageId) {
      try {
        embed.addFields({ name: "🔗 Convocation initiale", value: `[Aller au message](https://discord.com/channels/${guild.id}/${channel.id}/${convocation.messageId})`, inline: false });
      } catch (_) {}
    }
    try {
      await channel.send({
        content: `<@${member.id}>`,
        embeds: [embed],
        allowedMentions: { users: [member.id], roles: [], parse: [] }
      });
      await ModLogService.write(client, {
        guildId: guild.id,
        type: "convocation.reminder",
        targetUser: member.user,
        channelId: channel.id,
        convocationId: convocation._id,
        details: {
          offsetMs,
          msLeft,
          reasonLabel: convocation.reasonLabel,
          deadlineAt: convocation.deadlineAt
        }
      });
    } catch (err) {
      console.warn("⚠️  Échec envoi rappel :", err.message);
    }
  }

  async _processExpired(convocation) {
    convocation.status = CONVOC_STATUSES.EXPIRED;
    convocation.expiredAt = new Date();
    await convocation.save();
    const client = this.client;
    const guild = await client.guilds.fetch(convocation.guildId).catch(() => null);
    await ModLogService.write(client, {
      guildId: convocation.guildId,
      type: "convocation.expired",
      targetUserId: convocation.userId,
      issuerId: convocation.issuerId,
      convocationId: convocation._id,
      channelId: convocation.channelId,
      details: {
        reasonLabel: convocation.reasonLabel,
        requiredAction: convocation.requiredAction,
        deadlineAt: convocation.deadlineAt
      }
    });
    const sanction = convocation.sanctionIfExpired;
    if (!sanction || !sanction.type || sanction.type === "none" || !ALLOWED_SANCTION_TYPES.includes(sanction.type)) return;
    const success = await this._applySanction(convocation, guild, sanction);
    if (success) {
      convocation.status = CONVOC_STATUSES.SANCTIONED;
      convocation.sanctionedAt = new Date();
      await convocation.save();
    } else {
      convocation.status = CONVOC_STATUSES.EXPIRED;
      await convocation.save();
    }
  }

  async _applySanction(convocation, guild, sanction) {
    const client = this.client;
    if (!guild) {
      await this._logSanctionFailed(convocation, null, "Serveur introuvable");
      return false;
    }
    const botMember = await guild.members.fetch(client.user.id).catch(() => null);
    if (!botMember) {
      await this._logSanctionFailed(convocation, guild, "Bot absent du serveur");
      return false;
    }
    const targetMember = await guild.members.fetch(convocation.userId).catch(() => null);
    if (!targetMember) {
      await this._logSanctionFailed(convocation, guild, "Membre introuvable ou a quitté le serveur");
      return false;
    }
    const exempt = await PermissionService.isExempt(targetMember, guild.id);
    if (exempt) {
      await this._logSanctionFailed(convocation, guild, "Membre protégé (exempt)");
      return false;
    }
    if (targetMember.roles?.highest?.position >= botMember.roles?.highest?.position) {
      await this._logSanctionFailed(convocation, guild, "Rôle du bot insuffisant par rapport au membre");
      return false;
    }
    const me = guild.members.me;
    let ok = false;
    try {
      const reason = sanction.reason || "Convocation non respectée";
      const logDetails = {
        reasonLabel: convocation.reasonLabel,
        reason: sanction.reason || null,
        deadlineAt: convocation.deadlineAt,
        createdAt: convocation.createdAt,
        requiredAction: convocation.requiredAction,
        issuerId: convocation.issuerId,
        sanction: sanction.type
      };
      switch (sanction.type) {
        case "ban": {
          if (!me.permissions.has(PermissionFlagsBits.BanMembers)) throw new Error("Permission BanMembers manquante");
          await guild.members.ban(targetMember.id, { reason, deleteMessageSeconds: 0 });
          await ModLogService.write(client, {
            guildId: guild.id,
            type: "sanction.ban",
            targetUser: targetMember.user,
            issuerId: client.user.id,
            convocationId: convocation._id,
            details: logDetails
          });
          ok = true;
          break;
        }
        case "kick": {
          if (!me.permissions.has(PermissionFlagsBits.KickMembers)) throw new Error("Permission KickMembers manquante");
          await targetMember.kick(reason);
          await ModLogService.write(client, {
            guildId: guild.id,
            type: "sanction.kick",
            targetUser: targetMember.user,
            issuerId: client.user.id,
            convocationId: convocation._id,
            details: logDetails
          });
          ok = true;
          break;
        }
        case "mute":
        case "timeout": {
          if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) throw new Error("Permission ModerateMembers manquante");
          const duration = sanction.durationMs || 24 * 3600 * 1000;
          await targetMember.timeout(duration, reason);
          await ModLogService.write(client, {
            guildId: guild.id,
            type: "sanction.mute",
            targetUser: targetMember.user,
            issuerId: client.user.id,
            convocationId: convocation._id,
            details: { ...logDetails, durationMs: duration }
          });
          ok = true;
          break;
        }
        case "warn": {
          await ModLogService.write(client, {
            guildId: guild.id,
            type: "sanction.warn",
            targetUser: targetMember.user,
            issuerId: client.user.id,
            convocationId: convocation._id,
            details: logDetails
          });
          ok = true;
          break;
        }
        default:
          throw new Error(`Type de sanction non implémenté : ${sanction.type}`);
      }
      if (ok) {
        await ModLogService.write(client, {
          guildId: guild.id,
          type: "convocation.sanctioned",
          targetUser: targetMember.user,
          issuerId: client.user.id,
          convocationId: convocation._id,
          channelId: convocation.channelId,
          details: {
            ...logDetails,
            type: sanction.type,
            sanction: this._humanSanction(sanction)
          }
        });
      }
    } catch (err) {
      await this._logSanctionFailed(convocation, guild, err.message);
      convocation.failureLog = err.message;
      await convocation.save();
      ok = false;
    }
    return ok;
  }

  async _logSanctionFailed(convocation, guild, reason) {
    return ModLogService.write(this.client, {
      guildId: guild?.id || convocation.guildId,
      type: "convocation.sanction_failed",
      targetUserId: convocation.userId,
      issuerId: this.client?.user?.id || null,
      convocationId: convocation._id,
      channelId: convocation.channelId,
      details: {
        reasonLabel: convocation.reasonLabel,
        sanction: convocation.sanctionIfExpired?.type || null,
        failureReason: reason
      }
    });
  }

  async _logCompleted(convocation, resolverId) {
    return ModLogService.write(this.client, {
      guildId: convocation.guildId,
      type: "convocation.completed",
      targetUserId: convocation.userId,
      issuerId: convocation.issuerId,
      convocationId: convocation._id,
      channelId: convocation.channelId,
      details: {
        reasonLabel: convocation.reasonLabel,
        requiredAction: convocation.requiredAction,
        resolverId,
        note: convocation.resolutionNote || null
      }
    });
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
}

module.exports = new ConvocationScheduler();
