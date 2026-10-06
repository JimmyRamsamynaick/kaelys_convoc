const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const PermissionService = require("../../services/PermissionService");
const TicketIntegration = require("../../services/TicketIntegration");
const GuildConfigService = require("../../services/GuildConfigService");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("convoc-mark-ticket")
    .setDescription("Marque la convocation open_ticket comme résolue (lien message / salon+id / membre).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName("message")
        .setDescription("Lien Discord du message de création du ticket.")
        .setRequired(false)
    )
    .addChannelOption((o) =>
      o
        .setName("salon")
        .setDescription("Salon du message de ticket (si pas de lien).")
        .setRequired(false)
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.GuildForum,
          ChannelType.GuildMedia
        )
    )
    .addStringOption((o) =>
      o.setName("message_id").setDescription("ID du message de ticket (si pas de lien).").setRequired(false)
    )
    .addUserOption((o) =>
      o
        .setName("membre")
        .setDescription("Membre à qui appartient le ticket (override si l'auto-détection rate).")
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName("convocation_id")
        .setDescription("ID Mongo de la convocation à marquer précisément (optionnel).")
        .setRequired(false)
    ),
  async execute(interaction) {
    if (!(await PermissionService.isModerator(interaction.member, interaction.guildId))) {
      return interaction.reply({ content: "❌ Permission refusée.", flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });

    const mod = await GuildConfigService.getModeration(interaction.guildId);

    const rawUrl = interaction.options.getString("message");
    const channelOpt = interaction.options.getChannel("salon");
    const msgIdOpt = interaction.options.getString("message_id");
    const memberOpt = interaction.options.getMember("membre");
    const convocIdOpt = interaction.options.getString("convocation_id");

    let userIds = [];
    let channelForLog = null;
    let messageIdForLog = null;

    if (rawUrl) {
      try {
        const resolved = await TicketIntegration.resolveFromMessageUrl({
          client: interaction.client,
          messageUrl: rawUrl
        });
        if (String(resolved.guildId) !== String(interaction.guildId)) {
          return interaction.editReply({ content: "❌ Ce message n'appartient pas à ce serveur." });
        }
        userIds = resolved.userIds;
        channelForLog = resolved.channelId;
        messageIdForLog = resolved.messageId;
        if (memberOpt) userIds = [...new Set([memberOpt.id, ...userIds])];
      } catch (e) {
        return interaction.editReply({
          content:
            "❌ Impossible de lire ce lien/message : " + e.message +
            (/\b(10003|10008|missing access|Missing Permissions|Missing Access)\b/i.test(e.message)
              ? "\n💡 Solution : donne au bot la permission **Voir le salon** + **Historique des messages** sur ce channel, ou utilise l'option `membre` directement."
              : "")
        });
      }
    } else if (channelOpt && msgIdOpt) {
      try {
        const channel = await interaction.client.channels.fetch(channelOpt.id).catch(() => null);
        if (!channel) throw new Error("Channel introuvable.");
        const msg = await channel.messages.fetch(msgIdOpt).catch((e) => {
          throw new Error("Message introuvable : " + e.message);
        });
        userIds = (await TicketIntegration.scanTicketMessage({
          client: interaction.client,
          message: msg,
          explicitUserId: memberOpt?.id
        }))?.flatMap((r) => r.matched ? [r.userId] : []);
        if (!userIds.length) {
          const { extractUserIdsFromMessage } = require("../../services/TicketIntegration");
          userIds = extractUserIdsFromMessage(msg);
        }
        if (memberOpt?.id && !userIds.includes(memberOpt.id)) userIds.unshift(memberOpt.id);
        channelForLog = channel.id;
        messageIdForLog = msg.id;
      } catch (e) {
        return interaction.editReply({ content: "❌ " + e.message });
      }
    } else if (memberOpt) {
      userIds = [memberOpt.id];
    } else {
      return interaction.editReply({
        content: "❌ Fournis au minimum `message` (lien), ou `salon` + `message_id`, ou `membre`."
      });
    }

    if (!userIds.length) {
      return interaction.editReply({
        content:
          "❌ Je n'ai pas réussi à extraire l'ID du membre qui a ouvert le ticket.\n" +
          "💡 Solution : rajoute l'option `membre: @Utilisateur` pour forcer."
      });
    }

    const out = [];
    for (const uid of [...new Set(userIds)]) {
      const done = await TicketIntegration.markPendingConvocationCompleted({
        guildId: interaction.guildId,
        userId: uid,
        requiredAction: convocIdOpt ? null : "open_ticket",
        client: interaction.client,
        completedVia: `cmd:convoc-mark-ticket·${
          rawUrl ? "url" : channelForLog ? "channel+id" : "manual"
        }${messageIdForLog ? "·msg:" + messageIdForLog : ""}${convocIdOpt ? "·cid:" + convocIdOpt : ""}${
          channelForLog ? "·ch:" + channelForLog : ""
        }`,
        actorId: interaction.user.id,
        convocationId: convocIdOpt || undefined
      });
      out.push({ userId: uid, count: done.length, ids: done.map((d) => d._id) });

      if (convocIdOpt && done.length === 0) {
        // L'admin a forcé un ID, mais la convoc n'est pas PENDING (ex: déjà completed). On donne le vrai statut Mongo.
        try {
          const { default: Convocation } = require("../../models/Convocation");
          const raw = await Convocation.findById(convocIdOpt).select("status completedAt resolutionNote sanctionedAt").lean();
          if (raw) {
            out[out.length - 1].rawStatus = String(raw.status);
            out[out.length - 1].extra = `Statut Mongo actuel = ${raw.status}` + (raw.completedAt ? ` (completedAt=${raw.completedAt.toISOString()}, note=${raw.resolutionNote || "—"})` : "");
          }
        } catch (_) {}
      }
    }

    const total = out.reduce((a, b) => a + b.count, 0);
    const lines = out
      .map(({ userId, count, ids, extra, rawStatus }) => {
        return (
          `• <@${userId}> : ${count} convocation(s) marquée(s) résolue(s)` +
          (rawStatus ? ` · 🧱 status_db=\`${rawStatus}\`` : "") +
          (ids.length ? "\n  ID : " + ids.map(String).join(", ") : "") +
          (extra ? "\n  ℹ️  " + String(extra).slice(0, 200) : "")
        );
      })
      .join("\n");

    return interaction.editReply({
      embeds: [
        {
          color: total ? 0x22c55e : 0x99aab5,
          title: total ? "✅ Ticket pris en compte" : "ℹ️  Aucune convocation PENDING trouvée",
          description: total
            ? `${total} convocation(s) open_ticket passées en COMPLETED.\n` + (mod.ticketsChannelId ? `\n**Astuce** : positionne le salon **logs tickets** avec \`/config tickets-channel #salon\` pour que ça devienne **automatique** au prochain ticket.` : "")
            : "Aucune convocation `open_ticket` en attente pour ce membre. Vérifie :\n• que la convocation est bien `status: pending`\n• que l'ID du membre est correct.\n" + (mod.ticketsChannelId ? "" : "\n💡 Conseil : mets en place `/config tickets-channel #...` pour l'auto-détection future."),
          fields: [
            { name: "Membres traités", value: lines.slice(0, 1020) || "—" },
            { name: "Source", value: rawUrl ? `Lien fourni\nmessage_id=${messageIdForLog || "?"}` : channelForLog ? `#<#${channelForLog}>` : "`membre` fourni manuellement", inline: true },
            { name: "Option convocation_id", value: convocIdOpt ? String(convocIdOpt) : "—", inline: true }
          ]
        }
      ]
    });
  }
};
