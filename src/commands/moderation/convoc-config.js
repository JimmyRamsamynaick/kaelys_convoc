const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const GuildConfigService = require("../../services/GuildConfigService");
const PermissionService = require("../../services/PermissionService");
const { EMBED_COLORS } = require("../../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("convoc-config")
    .setDescription("Configurer les messages, délais et sanctions d'un type de convocation.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Clé du type de convocation (ex: verification)")
        .setRequired(true)
        .addChoices(
          { name: "Vérification", value: "verification" },
          { name: "Convocation", value: "convocation" },
          { name: "Modération", value: "moderation" },
          { name: "Entretien", value: "entretien" },
          { name: "Autre", value: "autre" }
        )
    )
    .addStringOption((o) => o.setName("label").setDescription("Libellé affiché").setRequired(false))
    .addStringOption((o) => o.setName("message").setDescription("Message de convocation").setRequired(false).setMaxLength(1000))
    .addIntegerOption((o) => o.setName("delai_heures").setDescription("Délai en heures (0 = aucun délai)").setRequired(false).setMinValue(0))
    .addStringOption((o) =>
      o
        .setName("action_requise")
        .setDescription("Action attendue")
        .setRequired(false)
        .addChoices(
          { name: "Ouvrir un ticket", value: "open_ticket" },
          { name: "Contacter la modération", value: "contact_staff" },
          { name: "Rejoindre un vocal", value: "join_voice" },
          { name: "Répondre dans le salon", value: "reply_in_channel" },
          { name: "Personnalisée", value: "custom" }
        )
    )
    .addStringOption((o) =>
      o
        .setName("sanction")
        .setDescription("Sanction en cas de non-respect")
        .setRequired(false)
        .addChoices(
          { name: "Aucune", value: "none" },
          { name: "Bannissement", value: "ban" },
          { name: "Exclusion", value: "kick" },
          { name: "Mute", value: "mute" },
          { name: "Avertissement", value: "warn" }
        )
    )
    .addIntegerOption((o) => o.setName("sanction_duree_heures").setDescription("Durée de mute en heures (sanction mute)").setRequired(false).setMinValue(0))
    .addStringOption((o) => o.setName("sanction_motif").setDescription("Motif de la sanction").setRequired(false).setMaxLength(500))
    .setDMPermission(false),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true)?.value || "";
    const reasons = await GuildConfigService.getReasons(interaction.guildId);
    const choices = Object.entries(reasons || {}).map(([k, v]) => ({ name: `${v.label || k} (${k})`, value: k }));
    const q = String(focused).toLowerCase();
    return q ? choices.filter((c) => c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q)) : choices;
  },
  async execute(interaction) {
    const allowed = await PermissionService.isModerator(interaction.member, interaction.guildId);
    if (!allowed || !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "❌ Permission refusée (Administrateur requis).", flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });
    const key = interaction.options.getString("type", true);
    const reasons = await GuildConfigService.getReasons(interaction.guildId);
    if (!reasons?.[key]) {
      return interaction.editReply({ content: `❌ Type de convocation introuvable : \`${key}\`` });
    }
    const patch = {};
    const label = interaction.options.getString("label", false);
    const message = interaction.options.getString("message", false);
    const hours = interaction.options.getInteger("delai_heures", false);
    const action = interaction.options.getString("action_requise", false);
    const sanctionType = interaction.options.getString("sanction", false);
    const sanctionHours = interaction.options.getInteger("sanction_duree_heures", false);
    const sanctionReason = interaction.options.getString("sanction_motif", false);
    if (label) patch.label = label;
    if (message) patch.message = message;
    if (hours != null) patch.deadlineMs = hours === 0 ? null : hours * 3600 * 1000;
    if (action) patch.requiredAction = action;
    if (sanctionType) {
      const current = reasons[key].sanctionIfExpired || {};
      patch.sanctionIfExpired = {
        ...current,
        type: sanctionType,
        ...(sanctionHours != null && (sanctionType === "mute" || sanctionType === "timeout") ? { durationMs: sanctionHours * 3600 * 1000 } : {}),
        ...(sanctionReason ? { reason: sanctionReason } : {})
      };
    } else if (sanctionHours != null || sanctionReason) {
      const current = reasons[key].sanctionIfExpired || { type: "mute" };
      patch.sanctionIfExpired = {
        ...current,
        ...(sanctionHours != null ? { durationMs: sanctionHours * 3600 * 1000 } : {}),
        ...(sanctionReason ? { reason: sanctionReason } : {})
      };
    }
    await GuildConfigService.setReason(interaction.guildId, key, patch);
    const updated = await GuildConfigService.getReasons(interaction.guildId);
    const r = updated[key];
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.SUCCESS)
      .setTitle(`✅ Convocation ${r.label || key} mise à jour`)
      .addFields(
        { name: "Libellé", value: String(r.label || key), inline: true },
        { name: "Message", value: String(r.message).slice(0, 1024), inline: false },
        { name: "Délai", value: r.deadlineMs ? `${Math.round(r.deadlineMs / 3600 / 1000)}h` : "Aucun", inline: true },
        { name: "Action requise", value: String(r.requiredAction || "custom"), inline: true }
      );
    if (r.sanctionIfExpired) {
      embed.addFields({
        name: "Sanction en cas de non-respect",
        value: `${r.sanctionIfExpired.type || "aucune"}${r.sanctionIfExpired.durationMs ? ` — durée ${Math.round(r.sanctionIfExpired.durationMs / 3600 / 1000)}h` : ""}${r.sanctionIfExpired.reason ? ` — motif : ${r.sanctionIfExpired.reason}` : ""}`,
        inline: false
      });
    }
    return interaction.editReply({ embeds: [embed] });
  }
};
