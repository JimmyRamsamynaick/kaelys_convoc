module.exports = {
  name: "interactionCreate",
  once: false,
  async execute(client, interaction) {
    if (!interaction?.guildId) return;

    if (interaction.isButton()) {
      const { decodeConvocButton } = require("../services/ConvocationService");
      const ConvocationService = require("../services/ConvocationService");
      const PermissionService = require("../services/PermissionService");
      const { EMBED_COLORS } = require("../config");
      const parsed = decodeConvocButton(interaction.customId);
      if (parsed) {
        try {
          const isMod = await PermissionService.isModerator(interaction.member, interaction.guildId);
          if (!isMod) {
            return interaction.reply({
              content: "❌ Permission refusée. Seul un modérateur peut utiliser ces boutons.",
              flags: 64
            });
          }
          await interaction.deferReply({ flags: 64 });
          if (parsed.action === "honor") {
            const res = await ConvocationService.honorConvocation({
              convocationId: parsed.convocationId,
              client,
              actorId: interaction.user.id,
              note: interaction.user.tag
            });
            if (!res.ok) {
              return interaction.editReply({
                embeds: [
                  {
                    color: EMBED_COLORS.WARNING,
                    title: "ℹ️  Convocation introuvable ou déjà traitée",
                    description:
                      res.code === "NOT_FOUND"
                        ? "Cette convocation n'existe plus."
                        : `Statut actuel de la convocation : \`${res.currentStatus || "?"}\``
                  }
                ]
              });
            }
            return interaction.editReply({
              embeds: [
                {
                  color: EMBED_COLORS.SUCCESS,
                  title: "✅ Convocation marquée honorée",
                  description:
                    `Membre : <@${res.convocation.userId}>\n` +
                    `Motif : ${res.convocation.reasonLabel || res.convocation.reasonKey}\n` +
                    `ID convocation : \`${res.convocation._id}\`\n` +
                    `Résolue via : bouton admin · ${interaction.user.tag}`
                }
              ]
            });
          }
          if (parsed.action === "cancel") {
            const done = await ConvocationService.cancelConvocation({
              convocationId: parsed.convocationId,
              client,
              actorId: interaction.user.id,
              reasonNote: "Bouton admin · " + interaction.user.tag
            });
            if (!done) {
              return interaction.editReply({
                embeds: [
                  {
                    color: EMBED_COLORS.WARNING,
                    title: "ℹ️  Convocation introuvable ou non PENDING",
                    description: "Elle est probablement déjà honorée, expirée, sanctionnée ou annulée."
                  }
                ]
              });
            }
            return interaction.editReply({
              embeds: [
                {
                  color: EMBED_COLORS.INFO,
                  title: "❌ Convocation annulée",
                  description:
                    `Membre : <@${done.userId}>\n` +
                    `Motif : ${done.reasonLabel || done.reasonKey}\n` +
                    `ID convocation : \`${done._id}\``
                }
              ]
            });
          }
        } catch (err) {
          return interaction
            .reply({
              content: "❌ Erreur lors du traitement du bouton : " + err.message,
              flags: 64
            })
            .catch(() => interaction.editReply({ content: "❌ Erreur : " + err.message }).catch(() => null));
        }
      }
    }

    const handler = client.commandHandler;
    if (handler) await handler.handle(interaction);
  }
};
