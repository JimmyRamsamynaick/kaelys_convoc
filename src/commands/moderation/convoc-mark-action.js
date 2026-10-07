const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const PermissionService = require("../../services/PermissionService");
const TicketIntegration = require("../../services/TicketIntegration");
const Convocation = require("../../models/Convocation");
const { CONVOC_STATUSES } = require("../../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("convoc-mark-action")
    .setDescription("Marque manuellement l'action d'une convocation comme effectuée.")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addUserOption((o) => o.setName("membre").setDescription("Membre concerné par la convocation.").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("action")
        .setDescription("Action requise que le membre a effectuée (open_ticket / join_voice / contact_staff / ...).")
        .setRequired(true)
        .addChoices(
          { name: "Ouvrir un ticket", value: "open_ticket" },
          { name: "Contacter un modérateur", value: "contact_staff" },
          { name: "Rejoindre un vocal", value: "join_voice" },
          { name: "Réponse dans le salon", value: "reply_in_channel" },
          { name: "Action personnalisée", value: "custom" },
          { name: "N'importe laquelle (pending)", value: "__any__" }
        )
    )
    .addStringOption((o) =>
      o
        .setName("commentaire")
        .setDescription("Commentaire interne enregistré dans la convocation (optionnel).")
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!(await PermissionService.isModerator(interaction.member, interaction.guildId))) {
      return interaction.reply({ content: "❌ Permission refusée.", flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });
    const target = interaction.options.getMember("membre", true);
    const action = interaction.options.getString("action", true);
    const note = interaction.options.getString("commentaire") || null;

    const requiredAction = action === "__any__" ? null : action;
    const updated = await TicketIntegration.markPendingConvocationCompleted({
      guildId: interaction.guildId,
      userId: target.id,
      requiredAction,
      client: interaction.client,
      completedVia: `cmd:convoc-mark-action${note ? " · " + note : ""}`,
      actorId: interaction.user.id
    });

    if (!updated.length) {
      const other = await Convocation.find({
        guildId: interaction.guildId,
        userId: target.id
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
      return interaction.editReply({
        content:
          "❌ Aucune convocation PENDING trouvée pour <@" + target.id + "> avec action requise `" + (requiredAction ?? "n'importe laquelle") + "`.\n" +
          (other.length
            ? "Autres convocations récentes :\n" + other.map((c) => `• ${c.reasonKey || c.reasonLabel || "?"} — status: ${c.status}`).join("\n")
            : "Aucune convocation du tout pour ce membre."
          )
      });
    }

    return interaction.editReply({
      embeds: [
        {
          color: 0x22c55e,
          title: "✅ Action marquée effectuée",
          fields: [
            { name: "👤 Membre", value: `<@${target.id}>`, inline: true },
            { name: "🎯 Action", value: String(action), inline: true },
            { name: "# Convocations marquées COMPLETED", value: String(updated.length), inline: true },
            {
              name: "🆔 ID convocations",
              value: updated.map((c) => "• " + String(c._id)).join("\n").slice(0, 1024),
              inline: false
            }
          ]
        }
      ]
    });
  }
};
