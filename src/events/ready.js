const DatabaseService = require("../services/DatabaseService");
const ConvocationScheduler = require("../services/ConvocationScheduler");
const GuildConfigService = require("../services/GuildConfigService");
const TicketIntegration = require("../services/TicketIntegration");

module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    console.log(`🤖 Connecté en tant que ${client.user.tag} (${client.user.id})`);
    client.user.setActivity("/convoc · Kaelys Convoc", { type: 4 });
    try {
      await DatabaseService.connect();
      client.dbReady = true;
    } catch (err) {
      client.dbReady = false;
      console.warn("⚠️  MongoDB indisponible — le bot fonctionne mais la persistance est désactivée.");
      console.warn("   -> Installe MongoDB local ou renseigne MONGO_URI (Atlas) dans le fichier .env.");
      console.warn("   -> Erreur :", err.message);
    }
    ConvocationScheduler.attach(client);
    if (client.dbReady) ConvocationScheduler.start();

    for (const [, guild] of client.guilds.cache) {
      try {
        const cfg = await GuildConfigService.getOrCreate(guild.id);
        const tc = cfg?.moderation?.ticketsCategoryId;
        if (tc) {
          const r = await TicketIntegration.autoResolveFromTicketCategory({
            client,
            guildId: guild.id,
            categoryId: tc,
            backfill: true
          }).catch(() => null);
          if (r) {
            console.log(
              `🟢 Ready backfill-tickets-category guild=${guild.id} category=${tc} scanned=${r.scanned} resolved=${r.resolved}`
            );
          }
        }
      } catch (_) {}
    }
  }
};
