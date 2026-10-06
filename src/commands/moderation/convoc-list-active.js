const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const PermissionService = require("../../services/PermissionService");
const Convocation = require("../../models/Convocation");
const { CONVOC_STATUSES, formatDate, EMBED_COLORS } = require("../../config");

const STATUSES = [
  { value: "all", label: "Toutes les convocations" },
  { value: CONVOC_STATUSES.PENDING, label: "En attente (pending)" },
  { value: CONVOC_STATUSES.COMPLETED, label: "Honorées (completed)" },
  { value: CONVOC_STATUSES.EXPIRED, label: "Expirées" },
  { value: CONVOC_STATUSES.SANCTIONED, label: "Sanctionnées" },
  { value: CONVOC_STATUSES.CANCELLED, label: "Annulées" }
];

const PER_PAGE = 10;

const EMOJI_STATUS = {
  [CONVOC_STATUSES.PENDING]: "⏳",
  [CONVOC_STATUSES.COMPLETED]: "✅",
  [CONVOC_STATUSES.EXPIRED]: "⌛",
  [CONVOC_STATUSES.SANCTIONED]: "⚖️",
  [CONVOC_STATUSES.CANCELLED]: "⛔"
};

const LABEL_STATUS = {
  [CONVOC_STATUSES.PENDING]: "En attente",
  [CONVOC_STATUSES.COMPLETED]: "Honorée",
  [CONVOC_STATUSES.EXPIRED]: "Expirée",
  [CONVOC_STATUSES.SANCTIONED]: "Sanctionnée",
  [CONVOC_STATUSES.CANCELLED]: "Annulée"
};

function colorFor(status) {
  if (status === CONVOC_STATUSES.COMPLETED) return EMBED_COLORS.SUCCESS;
  if ([CONVOC_STATUSES.EXPIRED, CONVOC_STATUSES.SANCTIONED, CONVOC_STATUSES.CANCELLED].includes(status)) return EMBED_COLORS.DANGER;
  if (status === CONVOC_STATUSES.PENDING) return EMBED_COLORS.WARNING;
  return EMBED_COLORS.INFO;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("convoc-list-active")
    .setDescription("Affiche la liste des convocations avec filtres (status, membre, raison, âge).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName("statut")
        .setDescription("Filtre par statut.")
        .setRequired(false)
        .addChoices(...STATUSES.map((s) => ({ name: s.label, value: s.value })))
    )
    .addUserOption((o) => o.setName("membre").setDescription("Convocations d'un membre précis.").setRequired(false))
    .addStringOption((o) =>
      o
        .setName("raison")
        .setDescription("Filtre sur la clé de raison (ex: verification).")
        .setRequired(false)
        .addChoices(
          { name: "Vérification", value: "verification" },
          { name: "Convocation", value: "convocation" },
          { name: "Modération", value: "moderation" },
          { name: "Entretien", value: "entretien" },
          { name: "Autre", value: "autre" }
        )
    )
    .addIntegerOption((o) =>
      o
        .setName("age_max_heures")
        .setDescription("Limiter aux convocations créées depuis moins de N heures.")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(24 * 60)
    )
    .addIntegerOption((o) =>
      o.setName("page").setDescription("Page (10 par page).").setRequired(false).setMinValue(1)
    )
    .addBooleanOption((o) =>
      o.setName("export").setDescription("Inclure un format brut CSV-like copiable.").setRequired(false)
    ),

  async autocomplete(interaction) {
    const reasons = await require("../../services/ConvocationService").reasonChoices(interaction.guildId).catch(() => []);
    return interaction.respond(reasons.slice(0, 25)).catch(() => null);
  },

  async execute(interaction) {
    if (!(await PermissionService.isModerator(interaction.member, interaction.guildId))) {
      return interaction.reply({ content: "❌ Permission refusée.", flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });

    const status = interaction.options.getString("statut") || "all";
    const membre = interaction.options.getMember("membre");
    const raison = interaction.options.getString("raison");
    const ageMaxHeures = interaction.options.getInteger("age_max_heures");
    const page = Math.max(1, interaction.options.getInteger("page") || 1);
    const exportBrut = interaction.options.getBoolean("export") ?? false;

    const query = { guildId: interaction.guildId };
    if (status !== "all") query.status = status;
    if (membre?.id) query.userId = membre.id;
    if (raison) query.reasonKey = raison;
    if (ageMaxHeures) query.createdAt = { $gte: new Date(Date.now() - ageMaxHeures * 3600 * 1000) };

    const total = await Convocation.countDocuments(query);
    const docs = await Convocation.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PER_PAGE)
      .limit(PER_PAGE)
      .lean();

    const pages = Math.max(1, Math.ceil(total / PER_PAGE));
    const embedColor = status === "all" ? EMBED_COLORS.INFO : colorFor(status);

    if (!docs.length) {
      return interaction.editReply({
        embeds: [
          {
            color: embedColor,
            title: "📋 Liste des convocations",
            description: "Aucune convocation ne correspond à ces filtres.",
            fields: [
              { name: "Statut", value: status, inline: true },
              { name: "Membre", value: membre ? `<@${membre.id}>` : "—", inline: true },
              { name: "Raison", value: raison || "—", inline: true },
              { name: "Total trouvé", value: String(total), inline: true }
            ]
          }
        ]
      });
    }

    const lines = [];
    for (const c of docs) {
      const e = EMOJI_STATUS[c.status] || "•";
      const s = LABEL_STATUS[c.status] || c.status;
      const created = formatDate(c.createdAt);
      const deadline = c.deadlineAt ? ` → deadline ${formatDate(c.deadlineAt)}` : "";
      const completed = c.status === CONVOC_STATUSES.COMPLETED && c.completedAt ? ` · complétée ${formatDate(c.completedAt)}` : "";
      const sanctioned = c.status === CONVOC_STATUSES.SANCTIONED && c.sanctionedAt ? ` · sanction ${formatDate(c.sanctionedAt)}` : "";
      const action = c.requiredAction ? ` · action:${c.requiredAction}` : "";
      const channel = c.channelId ? ` · <#${c.channelId}>` : "";
      const issuer = c.issuerId ? ` · by<@${c.issuerId}>` : "";
      const resolvedBy = c.resolvedBy ? ` · resolved_by<@${c.resolvedBy}>` : "";
      const resolutionNote = c.resolutionNote ? ` · note:${String(c.resolutionNote).slice(0, 80)}` : "";
      lines.push(
        `${e} **${s}** · <@${c.userId}> · \`${c.reasonKey}\`${action} · _${created}_${deadline}${completed}${sanctioned}${channel}${issuer}${resolvedBy}${resolutionNote}` +
          (c._id ? `\n  🆔 \`${c._id}\` · 🧱 status_db:\`${String(c.status)}\`` : "")
      );
    }

    const statsFields = [
      { name: "Statut", value: status, inline: true },
      { name: "Membre", value: membre ? `<@${membre.id}>` : "—", inline: true },
      { name: "Raison", value: raison || "—", inline: true },
      { name: "Total trouvé", value: String(total), inline: true },
      { name: "Page", value: `${page} / ${pages}`, inline: true },
      { name: "Âge max (h)", value: ageMaxHeures ? String(ageMaxHeures) : "—", inline: true }
    ];

    const mainEmbed = {
      color: embedColor,
      title: `📋 Liste des convocations · page ${page}/${pages}`,
      description: lines.join("\n\n").slice(0, 4096),
      fields: statsFields,
      footer: { text: "10 convocations par page · augmente page pour voir la suite." }
    };

    if (!exportBrut) return interaction.editReply({ embeds: [mainEmbed] });

    const csv = [
      "id;status;userId;userMention;reasonKey;reasonLabel;requiredAction;createdAt;deadlineAt;completedAt;sanctionedAt;channelId;issuerId;failureLog",
      ...docs.map((c) =>
        [
          String(c._id),
          c.status,
          c.userId,
          `<@${c.userId}>`,
          c.reasonKey,
          (c.reasonLabel || "").replace(/;/g, ","),
          c.requiredAction || "",
          formatDate(c.createdAt),
          c.deadlineAt ? formatDate(c.deadlineAt) : "",
          c.completedAt ? formatDate(c.completedAt) : "",
          c.sanctionedAt ? formatDate(c.sanctionedAt) : "",
          c.channelId || "",
          c.issuerId || "",
          (c.failureLog || "").replace(/[\r\n;]/g, " ").slice(0, 200)
        ].join(";")
      )
    ].join("\n");

    return interaction.editReply({
      embeds: [mainEmbed],
      content: "```csv\n" + csv.slice(0, 1900) + "\n```"
    });
  }
};
