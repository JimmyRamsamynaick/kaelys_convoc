const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const PermissionService = require("../../services/PermissionService");
const Convocation = require("../../models/Convocation");
const { formatDate, EMBED_COLORS } = require("../../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("convoc-debug")
    .setDescription("(Admin) Voir le document brut MongoDB d'une convocation (diagnostic fiable).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName("convocation_id").setDescription("ID Mongo de la convocation (24 hexa).").setRequired(true)
    )
    .addBooleanOption((o) => o.setName("json").setDescription("Inclure le JSON complet (brut).").setRequired(false)),
  async execute(interaction) {
    if (!(await PermissionService.isModerator(interaction.member, interaction.guildId))) {
      return interaction.reply({ content: "❌ Permission refusée.", flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });
    const cid = interaction.options.getString("convocation_id", true);
    const includeJson = interaction.options.getBoolean("json") ?? false;
    const doc = await Convocation.findById(cid).lean().maxTimeMS(15000).catch(() => null);
    if (!doc) return interaction.editReply({ content: "❌ Convocation introuvable avec cet ID." });
    if (String(doc.guildId) !== String(interaction.guildId)) {
      return interaction.editReply({ content: "❌ Cette convocation n'appartient pas à cette guilde." });
    }
    const fields = [
      { name: "🧱 status_db", value: `\`${String(doc.status)}\``, inline: true },
      { name: "👤 userId", value: `<@${doc.userId}>\n\`${doc.userId}\``, inline: true },
      { name: "👮 issuerId", value: doc.issuerId ? `<@${doc.issuerId}>\n\`${doc.issuerId}\`` : "—", inline: true },
      { name: "📋 reasonKey / label", value: `\`${doc.reasonKey}\` · ${doc.reasonLabel || "?"}`, inline: true },
      { name: "🎯 requiredAction", value: `\`${String(doc.requiredAction)}\``, inline: true },
      { name: "📍 channelId", value: doc.channelId ? `<#${doc.channelId}>\n\`${doc.channelId}\`` : "—", inline: true },
      { name: "🆔 messageId", value: doc.messageId ? `\`${doc.messageId}\`` : "—", inline: true },
      { name: "🕒 createdAt", value: formatDate(doc.createdAt), inline: true },
      { name: "⏰ deadlineAt", value: doc.deadlineAt ? formatDate(doc.deadlineAt) : "—", inline: true },
      { name: "✅ completedAt", value: doc.completedAt ? formatDate(doc.completedAt) : "—", inline: true },
      { name: "🎟️ resolutionNote", value: doc.resolutionNote ? String(doc.resolutionNote).slice(0, 1024) : "—", inline: true },
      { name: "🙋 resolvedBy", value: doc.resolvedBy ? `<@${doc.resolvedBy}>` : "—", inline: true },
      { name: "⚖️ sanctionIfExpired", value: doc.sanctionIfExpired ? `\`\`\`json\n${JSON.stringify(doc.sanctionIfExpired, null, 2).slice(0, 980)}\n\`\`\`` : "—", inline: false }
    ];
    const embed = {
      color: EMBED_COLORS.INFO,
      title: `🔍 Convocation ${doc._id}`,
      fields,
      footer: { text: "Source directe : MongoDB / collection convocations" }
    };
    if (!includeJson) return interaction.editReply({ embeds: [embed] });
    const jsonBlock = "```json\n" + JSON.stringify(doc, null, 2).slice(0, 1900) + "\n```";
    return interaction.editReply({ embeds: [embed], content: jsonBlock });
  }
};
