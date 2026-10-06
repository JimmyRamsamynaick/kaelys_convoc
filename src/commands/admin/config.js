const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, Role } = require("discord.js");
const GuildConfigService = require("../../services/GuildConfigService");
const PermissionService = require("../../services/PermissionService");
const ModLogService = require("../../services/ModLogService");
const { EMBED_COLORS } = require("../../config");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Gérer la configuration de modération du serveur.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("convocation-channel")
        .setDescription("Définir le salon dans lequel sont envoyées les convocations.")
        .addChannelOption((o) =>
          o
            .setName("salon")
            .setDescription("Salon textuel dédié aux convocations")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("logs-channel")
        .setDescription("Définir le salon des logs de modération.")
        .addChannelOption((o) =>
          o
            .setName("salon")
            .setDescription("Salon textuel dédié aux logs")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("tickets-channel")
        .setDescription("Salon où arrivent les logs/messages de tickets (pour auto-détection).")
        .addChannelOption((o) =>
          o
            .setName("salon")
            .setDescription("Salon textuel / forum / logs tickets")
            .setRequired(true)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildMedia
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("tickets-category")
        .setDescription("Catégorie où sont créés les salons de ticket (ex: catégorie Tickets).")
        .addChannelOption((o) =>
          o
            .setName("categorie")
            .setDescription("Catégorie Discord cible")
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildCategory)
        )
    )
    .addSubcommandGroup((group) =>
      group
        .setName("roles")
        .setDescription("Gérer les rôles de modération et d'exemption.")
        .addSubcommand((sub) =>
          sub
            .setName("mod-add")
            .setDescription("Ajouter un rôle autorisé à utiliser les commandes de modération.")
            .addRoleOption((o) => o.setName("role").setDescription("Rôle de modération").setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName("mod-remove")
            .setDescription("Retirer un rôle de la liste de modération.")
            .addRoleOption((o) => o.setName("role").setDescription("Rôle de modération").setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName("exempt-add")
            .setDescription("Ajouter un rôle protégé (impossible à convoquer / sanctionner automatiquement).")
            .addRoleOption((o) => o.setName("role").setDescription("Rôle protégé").setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName("exempt-remove")
            .setDescription("Retirer un rôle de la liste des exemptions.")
            .addRoleOption((o) => o.setName("role").setDescription("Rôle protégé").setRequired(true))
        )
    )
    .addSubcommand((sub) => sub.setName("view").setDescription("Afficher la configuration de modération du serveur.")),
  async execute(interaction, client) {
    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    if (!isAdmin) {
      return interaction.reply({ content: "❌ Permission refusée (Administrateur requis).", flags: 64 });
    }
    await interaction.deferReply({ flags: 64 });
    const sub = interaction.options.getSubcommand(true);
    const group = interaction.options.getSubcommandGroup(false);
    const mod = await GuildConfigService.getModeration(interaction.guildId);
    if (sub === "convocation-channel") {
      const channel = interaction.options.getChannel("salon", true);
      await GuildConfigService.setModerationField(interaction.guildId, "convocationChannelId", channel.id);
      await ModLogService.write(client, {
        guildId: interaction.guildId,
        type: "guild_config.updated",
        issuer: interaction.user,
        details: { key: "convocationChannelId", value: channel.id }
      });
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.SUCCESS)
        .setTitle("✅ Configuration enregistrée")
        .addFields({ name: "Salon des convocations", value: `${channel}` });
      return interaction.editReply({ embeds: [embed] });
    }
    if (sub === "logs-channel") {
      const channel = interaction.options.getChannel("salon", true);
      await GuildConfigService.setModerationField(interaction.guildId, "logsChannelId", channel.id);
      await ModLogService.write(client, {
        guildId: interaction.guildId,
        type: "guild_config.updated",
        issuer: interaction.user,
        details: { key: "logsChannelId", value: channel.id }
      });
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.SUCCESS)
        .setTitle("✅ Configuration enregistrée")
        .addFields({ name: "Salon des logs", value: `${channel}` });
      return interaction.editReply({ embeds: [embed] });
    }
    if (sub === "tickets-channel") {
      const channel = interaction.options.getChannel("salon", true);
      await GuildConfigService.setModerationField(interaction.guildId, "ticketsChannelId", channel.id);
      await ModLogService.write(client, {
        guildId: interaction.guildId,
        type: "guild_config.updated",
        issuer: interaction.user,
        details: { key: "ticketsChannelId", value: channel.id }
      });
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.SUCCESS)
        .setTitle("✅ Configuration enregistrée")
        .addFields({
          name: "Salon / logs tickets",
          value: `${channel}\n\nℹ️  Les messages postés ici seront analysés à chaque nouveau message (si intent Message Content activé) + via scheduler / backfill REST.`
        });
      return interaction.editReply({ embeds: [embed] });
    }
    if (sub === "tickets-category") {
      const channel = interaction.options.getChannel("categorie", true);
      await GuildConfigService.setModerationField(interaction.guildId, "ticketsCategoryId", channel.id);
      await ModLogService.write(client, {
        guildId: interaction.guildId,
        type: "guild_config.updated",
        issuer: interaction.user,
        details: { key: "ticketsCategoryId", value: channel.id }
      });
      const TicketIntegration = require("../../services/TicketIntegration");
      let scanned = 0;
      let resolved = 0;
      try {
        const r = await TicketIntegration.autoResolveFromTicketCategory({
          client,
          guildId: interaction.guildId,
          categoryId: channel.id,
          maxChannels: 200,
          backfill: true
        });
        scanned = r.scanned;
        resolved = r.resolved;
      } catch (e) {}
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.SUCCESS)
        .setTitle("✅ Configuration enregistrée")
        .addFields(
          {
            name: "Catégorie tickets",
            value: `${channel}`,
            inline: true
          },
          {
            name: "Backfill immédiat",
            value: `Salons scannés : ${scanned}\nConvocations marquées honorées : ${resolved}`,
            inline: true
          },
          {
            name: "Fonctionnement",
            value:
              "• Dès qu'un salon est créé ou déplacé dans cette catégorie, la convocation `open_ticket` correspondante est marquée COMPLETED.\n" +
              "• Au démarrage du bot, backfill automatique de tous les salons dans cette catégorie.\n" +
              "• À chaque scheduler (toutes les 30s), on vérifie les nouveaux salons créés.\n"
          }
        );
      return interaction.editReply({ embeds: [embed] });
    }
    if (group === "roles") {
      const role = interaction.options.getRole("role", true);
      if (sub === "mod-add" || sub === "mod-remove") {
        const current = new Set(mod.modRoleIds || []);
        if (sub === "mod-add") current.add(role.id);
        else current.delete(role.id);
        await GuildConfigService.setModerationField(interaction.guildId, "modRoleIds", [...current]);
        await ModLogService.write(client, {
          guildId: interaction.guildId,
          type: "guild_config.updated",
          issuer: interaction.user,
          details: { key: "modRoleIds", value: [...current], change: sub, roleId: role.id, roleName: role.name }
        });
        return interaction.editReply({
          embeds: [successEmbed(sub === "mod-add" ? "Rôle de modération ajouté" : "Rôle de modération retiré", { Rôle: `<@&${role.id}>` })]
        });
      }
      if (sub === "exempt-add" || sub === "exempt-remove") {
        const current = new Set(mod.exemptRoleIds || []);
        if (sub === "exempt-add") current.add(role.id);
        else current.delete(role.id);
        await GuildConfigService.setModerationField(interaction.guildId, "exemptRoleIds", [...current]);
        await ModLogService.write(client, {
          guildId: interaction.guildId,
          type: "guild_config.updated",
          issuer: interaction.user,
          details: { key: "exemptRoleIds", value: [...current], change: sub, roleId: role.id, roleName: role.name }
        });
        return interaction.editReply({
          embeds: [successEmbed(sub === "exempt-add" ? "Rôle d'exemption ajouté" : "Rôle d'exemption retiré", { Rôle: `<@&${role.id}>` })]
        });
      }
    }
    if (sub === "view") {
      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.INFO)
        .setTitle("⚙️  Configuration du serveur")
        .addFields(
          { name: "Salon des convocations", value: mod.convocationChannelId ? `<#${mod.convocationChannelId}>` : "❌ Non configuré", inline: true },
          { name: "Salon des logs", value: mod.logsChannelId ? `<#${mod.logsChannelId}>` : "ℹ️  Non défini", inline: true },
          { name: "Salon tickets / logs tickets", value: mod.ticketsChannelId ? `<#${mod.ticketsChannelId}>` : "ℹ️  Non défini", inline: true },
          { name: "Catégorie tickets", value: mod.ticketsCategoryId ? `<#${mod.ticketsCategoryId}>` : "ℹ️  Non définie", inline: true },
          { name: "Rôles modérateurs", value: (mod.modRoleIds || []).map((r) => `<@&${r}>`).join("\n") || "Administrateur / ManageGuild par défaut", inline: false },
          { name: "Rôles protégés", value: (mod.exemptRoleIds || []).map((r) => `<@&${r}>`).join("\n") || "Aucun", inline: false },
          { name: "Types de convocations", value: Object.keys(mod.reasons || {}).join(", ") || "Aucun", inline: false }
        );
      return interaction.editReply({ embeds: [embed] });
    }
    return interaction.editReply({ content: "❌ Sous-commande inconnue." });
  }
};

function successEmbed(title, fields) {
  const e = new EmbedBuilder().setColor(EMBED_COLORS.SUCCESS).setTitle(`✅ ${title}`);
  for (const [n, v] of Object.entries(fields || {})) e.addFields({ name: n, value: String(v), inline: true });
  return e;
}
