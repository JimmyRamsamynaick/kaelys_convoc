const GuildConfigService = require("../services/GuildConfigService");

module.exports = {
  name: "guildCreate",
  once: false,
  async execute(client, guild) {
    try {
      await GuildConfigService.getOrCreate(guild.id);
      console.log(`✨ Serveur ajouté : ${guild.name} (${guild.id}) — configuration initialisée.`);
    } catch (err) {
      console.error(`❌ Échec initialisation serveur ${guild.id}:`, err.message);
    }
  }
};
