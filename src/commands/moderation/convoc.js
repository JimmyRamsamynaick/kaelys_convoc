const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const ConvocationService = require("../../services/ConvocationService");
const PermissionService = require("../../services/PermissionService");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("convoc")
    .setDescription("Convoquer un membre dans le salon dédié aux convocations.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) =>
      opt.setName("membre").setDescription("Membre à convoquer").setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("raison")
        .setDescription("Type de convocation")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("details")
        .setDescription("Détails personnalisés (obligatoire si raison = autre)")
        .setRequired(false)
        .setMaxLength(1000)
    )
    .setDMPermission(false),
  async autocomplete(interaction) {
    const choices = await ConvocationService.reasonChoices(interaction.guildId);
    const focused = interaction.options.getFocused(true)?.value || "";
    const query = String(focused).toLowerCase();
    const filtered = query
      ? choices.filter((c) => c.name.toLowerCase().includes(query) || c.value.toLowerCase().includes(query))
      : choices;
    return filtered;
  },
  async execute(interaction, client) {
    const allowed = await PermissionService.isModerator(interaction.member, interaction.guildId);
    if (!allowed) {
      return interaction.reply({
        content: "❌ Permission refusée.",
        flags: 64
      });
    }
    await interaction.deferReply({ flags: 64 });
    const target = interaction.options.getMember("membre");
    const reasonKey = interaction.options.getString("raison", true);
    const details = interaction.options.getString("details", false);
    const result = await ConvocationService.send({
      client,
      interaction,
      issuerMember: interaction.member,
      targetMember: target,
      reasonKey,
      customDetails: details
    });
    if (!result.ok) {
      return interaction.editReply({
        content: result.message || "❌ Convocation impossible."
      });
    }
    return interaction.editReply({
      embeds: [result.confirmationEmbed]
    });
  }
};
