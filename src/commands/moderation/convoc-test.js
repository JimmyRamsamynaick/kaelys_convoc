const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const ConvocationService = require("../../services/ConvocationService");
const GuildConfigService = require("../../services/GuildConfigService");
const PermissionService = require("../../services/PermissionService");
const ModLogService = require("../../services/ModLogService");
const Convocation = require("../../models/Convocation");
const { CONVOC_STATUSES, EMBED_COLORS, formatDate } = require("../../config");

const ACTIONS = [
  ["open_ticket", "Ouvrir un ticket"],
  ["contact_staff", "Contacter un modérateur"],
  ["join_voice", "Rejoindre un vocal"],
  ["reply_in_channel", "Répondre dans le salon"],
  ["custom", "Action personnalisée"]
];

const SANCTIONS = [
  ["none", "Aucune"],
  ["ban", "Bannissement"],
  ["kick", "Exclusion"],
  ["timeout", "Rendez-vous muet"],
  ["warn", "Avertissement"]
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("convoc-test")
    .setDescription("🛠️ Commande admin de test : convocation avec délai personnalisé.")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .addUserOption((o) => o.setName("membre").setDescription("Membre à convoquer (test).").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("raison")
        .setDescription("Type de convocation à tester (clé).")
        .setRequired(true)
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
        .setName("delai_minutes")
        .setDescription("Délai personnalisé avant expiration (en minutes). 0 = pas de délai.")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(525600)
    )
    .addStringOption((o) =>
      o
        .setName("message_perso")
        .setDescription("Remplace le message du type de convocation pour ce test.")
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName("action_requise")
        .setDescription("Action attendue avant expiration.")
        .setRequired(false)
        .addChoices(...ACTIONS.map(([v, n]) => ({ name: n, value: v })))
    )
    .addStringOption((o) =>
      o
        .setName("sanction")
        .setDescription("Sanction si délai expiré.")
        .setRequired(false)
        .addChoices(...SANCTIONS.map(([v, n]) => ({ name: n, value: v })))
    )
    .addIntegerOption((o) =>
      o
        .setName("rappels_minutes")
        .setDescription("Rappels (minutes avant l'expiration), séparés par des virgules. Ex: 30,10,1")
        .setRequired(false)
    )
    .addBooleanOption((o) =>
      o
        .setName("simulation")
        .setDescription("Si true : pas d'envoi Discord, retourne seulement ce qui aurait été fait.")
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName("details")
        .setDescription("Détails personnalisés (utile si raison = autre).")
        .setRequired(false)
    ),

  async autocomplete(interaction) {
    const choices = await ConvocationService.reasonChoices(interaction.guildId);
    return interaction.respond(choices).catch(() => null);
  },

  async execute(interaction) {
    if (!(await PermissionService.isModerator(interaction.member, interaction.guildId))) {
      return interaction.reply({ content: "❌ Permission refusée (Administrateur requis).", flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });

    const targetMember = interaction.options.getMember("membre", true);
    const reasonKey = interaction.options.getString("raison", true);
    const delayMinutes = interaction.options.getInteger("delai_minutes", true);
    const customMessage = interaction.options.getString("message_perso") || null;
    const requiredAction = interaction.options.getString("action_requise") || null;
    const sanction = interaction.options.getString("sanction") || null;
    const remindersRaw = interaction.options.getString("rappels_minutes") || null;
    const dryRun = interaction.options.getBoolean("simulation") ?? false;
    const customDetails = interaction.options.getString("details") || null;

    const reasons = await GuildConfigService.getReasons(interaction.guildId);
    const baseReason = reasons?.[reasonKey];
    if (!baseReason) {
      return interaction.editReply({ content: "❌ Raison inconnue. Utilise /convoc-list pour voir les clés disponibles." });
    }

    const overriddenReason = { ...baseReason };
    if (customMessage) overriddenReason.message = customMessage;
    if (requiredAction) overriddenReason.requiredAction = requiredAction;
    overriddenReason.deadlineMs = delayMinutes * 60 * 1000;
    if (remindersRaw) {
      overriddenReason.reminderOffsetsMs = remindersRaw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => n * 60 * 1000);
    } else if (!overriddenReason.reminderOffsetsMs?.length) {
      overriddenReason.reminderOffsetsMs = [];
    }
    if (sanction) {
      overriddenReason.sanctionIfExpired = {
        type: sanction,
        durationMs: null,
        reason: baseReason.sanctionIfExpired?.reason || "Convocation de test non respectée."
      };
    }

    const now = new Date();
    const deadlineAt = overriddenReason.deadlineMs ? new Date(now.getTime() + overriddenReason.deadlineMs) : null;

    if (dryRun) {
      const { embed } = ConvocationService.buildConvocEmbed({
        targetMember,
        issuerMember: interaction.member,
        reason: overriddenReason,
        reasonKey,
        customDetails,
        deadlineAt
      });
      embed
        .setTitle("🧪 SIMULATION — Convocation qui aurait été envoyée")
        .setColor(EMBED_COLORS.WARN ?? 0xffaa33);
      return interaction.editReply({
        content: `Target: <@${targetMember.id}> (pas d'envoi, simulation=true)`,
        embeds: [embed]
      });
    }

    const testKey =
      "__test_" +
      Buffer.from(interaction.user.id + ":" + Math.random().toString(36).slice(2, 10) + ":" + Date.now())
        .toString("base64url")
        .slice(0, 32);

    try {
      await GuildConfigService.setReason(interaction.guildId, testKey, overriddenReason);
      const result = await ConvocationService.send({
        client: interaction.client,
        interaction,
        issuerMember: interaction.member,
        targetMember,
        reasonKey: testKey,
        customDetails
      });
      if (!result.ok) {
        return interaction.editReply({ content: result.message });
      }
      const reloaded = await Convocation.findOne({ _id: result.convocation._id }).lean();
      await ModLogService.write(interaction.client, {
        guildId: interaction.guildId,
        type: "convocation.created_test",
        targetUser: targetMember.user,
        issuer: interaction.user,
        channelId: reloaded?.channelId,
        convocationId: reloaded?._id,
        details: {
          basedOn: reasonKey,
          testKey,
          overrideDeadlineMinutes: delayMinutes,
          overrideDeadlineAt: deadlineAt,
          overrideRequiredAction: requiredAction,
          overrideSanction: sanction,
          overrideRemindersMinutes: remindersRaw,
          overrideMessage: customMessage ? true : false
        }
      });
      const summary = {
        "✅ Convocation de TEST envoyée": "\u200B",
        "👤 Membre": `<@${targetMember.id}>`,
        "📋 Type (base)": `${reasonKey} · ${baseReason.label}`,
        "⏰ Délai": delayMinutes ? `${delayMinutes} minute(s) → ${formatDate(deadlineAt)}` : "Aucun",
        "🎯 Action requise": String(reloaded?.requiredAction ?? overriddenReason.requiredAction ?? "—"),
        "⚠️ Sanction si expiré": overriddenReason.sanctionIfExpired?.type ?? "Aucune",
        "📍 Salon": `<#${reloaded?.channelId ?? result.message?.channelId ?? interaction.channelId}>`
      };
      return interaction.editReply({
        embeds: [
          {
            color: 0x22c55e,
            title: "🧪 Convocation de TEST créée",
            fields: Object.entries(summary).map(([n, v]) => ({
              name: n,
              value: String(v),
              inline: /Membre|Type \(base\)|Délai|Sanction/.test(n)
            })),
            footer: { text: `ID convocation: ${reloaded?._id}` }
          }
        ]
      });
    } finally {
      try {
        await GuildConfigService.update(interaction.guildId, (doc) => {
          const current = doc.moderation.reasons;
          if (current instanceof Map) current.delete(testKey);
          else if (current && typeof current === "object") delete current[testKey];
        });
      } catch (_) {}
    }
  }
};
