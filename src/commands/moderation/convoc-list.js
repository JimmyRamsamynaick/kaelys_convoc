const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const ConvocationService = require("../../services/ConvocationService");
const PermissionService = require("../../services/PermissionService");
const { EMBED_COLORS } = require("../../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("convoc-list")
    .setDescription("Afficher les types de convocations disponibles sur ce serveur.")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .setDMPermission(false),
  async execute(interaction) {
    const allowed = await PermissionService.isModerator(interaction.member, interaction.guildId);
    if (!allowed) {
      return interaction.reply({ content: "❌ Permission refusée.", flags: 64 });
    }
    const reasons = await ConvocationService.listReasons(interaction.guildId);
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.INFO)
      .setTitle("📋 Types de convocations")
      .setDescription("Liste des types de convocations configurés pour ce serveur.");
    const entries = Object.entries(reasons || {});
    if (!entries.length) {
      embed.addFields({ name: "Aucun", value: "Aucun type de convocation configuré." });
    } else {
      for (const [key, r] of entries) {
        const lines = [];
        lines.push(`**Clé** : \`${key}\``);
        lines.push(`**Message** : ${String(r.message).slice(0, 200)}`);
        if (r.requiredAction) lines.push(`**Action attendue** : \`${r.requiredAction}\``);
        if (r.deadlineMs) lines.push(`**Délai** : ${humanOffset(r.deadlineMs)}`);
        if (r.sanctionIfExpired?.type && r.sanctionIfExpired.type !== "none") {
          lines.push(`**Sanction** : ${humanSanction(r.sanctionIfExpired)}`);
        }
        embed.addFields({
          name: `🗂️  ${r.label || key}`,
          value: lines.join("\n"),
          inline: false
        });
      }
    }
    return interaction.reply({ embeds: [embed], flags: 64 });
  }
};

function humanOffset(ms) {
  if (!ms) return "indéfini";
  const sec = Math.max(1, Math.round(ms / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}j`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}min`);
  if (!parts.length) parts.push(`${sec}s`);
  return parts.join(" ");
}
function humanSanction(s) {
  const reason = s.reason ? ` — ${s.reason}` : "";
  const dur = s.durationMs ? ` pour ${humanOffset(s.durationMs)}` : "";
  switch (s.type) {
    case "ban": return `Bannissement${dur}${reason}`;
    case "kick": return `Exclusion${reason}`;
    case "mute":
    case "timeout": return `Mute${dur || " défini"}${reason}`;
    case "warn": return `Avertissement${reason}`;
    default: return "Aucune";
  }
}
