const path = require("path");
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { DISCORD_BOT_TOKEN } = require("./src/config");
const CommandHandler = require("./src/handlers/CommandHandler");
const EventHandler = require("./src/handlers/EventHandler");

(async function main() {
  const baseIntents = [GatewayIntentBits.Guilds];
  try {
    const testCfg = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates];
    if (process.env.DISCORD_EXTRA_INTENTS) {
      const extra = process.env.DISCORD_EXTRA_INTENTS.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const k of extra) {
        if (k in GatewayIntentBits) testCfg.push(GatewayIntentBits[k]);
      }
    }
    baseIntents.push(GatewayIntentBits.GuildVoiceStates);
  } catch (_) {}
  const client = new Client({
    intents: baseIntents,
    partials: [Partials.Channel, Partials.Message]
  });

  client.on("shardError", (err) => {
    console.warn("🔌 Shard error:", err.message);
    if (/Used disallowed intents|Privileged/i.test(err.message || "")) {
      const clientId = process.env.DISCORD_CLIENT_ID || "";
      console.warn(
        "\n" +
          "⚠️  INTENT PRIVILÉGIÉ NON ACTIVÉ (Used disallowed intents) :\n" +
          `  👉 Ouvre : https://discord.com/developers/applications/${clientId}/bot\n` +
          "  Rubrique « Privileged Gateway Intents »\n" +
          "  Active SÉPARÉMENT selon besoin :\n" +
          "    • Message Content Intent   (obligatoire pour lire le contenu des messages utilisateur, auto-détection tickets par messageCreate)\n" +
          "    • Guild Members Intent   (si tu lis/synchronise members)\n" +
          "    • Presence Intent\n\n" +
          "  Intents actuellement utilisés par le bot : " +
          baseIntents.map((n) => Object.keys(GatewayIntentBits).find((k) => GatewayIntentBits[k] === n) || n).join(", ") +
          "\n" +
          "  Tant que Message Content est OFF, l'auto ne se déclenche pas via messageCreate.\n" +
          "  ✅ Solution 100 % fiable SANS ACTIVER Message Content Intent :\n" +
          "     • bouton ✅ « Marquer honorée » sous chaque convocation (1 clic admin)\n" +
          "     • /convoc-mark-ticket message:\"<ton lien>\" membre:@User convocation_id:<ID>\n" +
          "     • /convoc-scan-tickets salon:#... limite:100 (backfill REST direct sans MessageContent)\n"
      );
    }
  });

  client.commandHandler = new CommandHandler(client, path.join(__dirname, "src", "commands"));
  await client.commandHandler.load();

  const eventHandler = new EventHandler(client, path.join(__dirname, "src", "events"));
  eventHandler.load();

  process.on("unhandledRejection", (reason, promise) => {
    console.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("💥 Uncaught Exception:", err);
  });

  if (!DISCORD_BOT_TOKEN) {
    console.error("❌ DISCORD_BOT_TOKEN est absent. Crée un fichier .env à partir de .env.example.");
    process.exit(1);
  }
  await client.login(DISCORD_BOT_TOKEN);
})();
