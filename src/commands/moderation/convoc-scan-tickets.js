const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const PermissionService = require("../../services/PermissionService");
const TicketIntegration = require("../../services/TicketIntegration");
const GuildConfigService = require("../../services/GuildConfigService");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("convoc-scan-tickets")
    .setDescription("Scanne les N derniers messages d'un salon à la recherche de tickets ouverts.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o
        .setName("salon")
        .setDescription("Salon/thread/forum où scanner les messages.")
        .setRequired(true)
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread
        )
    )
    .addIntegerOption((o) =>
      o.setName("limite").setDescription("Nombre de messages à scanner (1-100).").setRequired(false).setMinValue(1).setMaxValue(100)
    ),
  async execute(interaction) {
    if (!(await PermissionService.isModerator(interaction.member, interaction.guildId))) {
      return interaction.reply({ content: "❌ Permission refusée.", flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });
    const channel = interaction.options.getChannel("salon", true);
    const limit = interaction.options.getInteger("limite") || 50;
    const mod = await GuildConfigService.getModeration(interaction.guildId);
    try {
      const matches = await TicketIntegration.scanChannelForRecentTickets({
        client: interaction.client,
        guildId: interaction.guildId,
        channelId: channel.id,
        limit,
        explicitTicketsChannelId: mod.ticketsChannelId || channel.id
      });
      const flat = matches.flatMap((m) => (m.matches || []).map((x) => ({ ...x, messageId: m.messageId })));
      const totalResolved = flat.reduce((a, b) => a + (b.convocations?.length || 0), 0);
      const lines = flat.slice(0, 30).map(({ userId, messageId, convocations, detector }) => {
        return `• <#${channel.id}>/messages/${messageId} → <@${userId}> : ${
          convocations?.length || 0
        } résolue(s) (${detector || "?"})`;
      });
      return interaction.editReply({
        embeds: [
          {
            color: totalResolved ? 0x22c55e : 0x3498db,
            title: `📡 Scan terminé (${flat.length} message(s) ressemblant à un ticket)`,
            description: `${totalResolved} convocation(s) marquées COMPLETED.`,
            fields: [
              { name: "Salon", value: `<#${channel.id}>`, inline: true },
              { name: "Limite", value: String(limit), inline: true },
              { name: "Détails", value: lines.join("\n").slice(0, 1020) || "Aucune correspondance." }
            ]
          }
        ]
      });
    } catch (e) {
      return interaction.editReply({
        content: "❌ Échec du scan : " + e.message
      });
    }
  }
};
