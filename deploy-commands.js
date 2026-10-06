const path = require("path");
const fs = require("fs");
const { REST, Routes } = require("discord.js");
const { DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_TEST_GUILD_ID } = require("./src/config");

async function collectCommands() {
  const dir = path.join(__dirname, "src", "commands");
  const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile() && e.name.endsWith(".js"));
  const out = [];
  for (const entry of entries) {
    const full = path.join(entry.path || dir, entry.name);
    try {
      const mod = require(full);
      const command = mod.default || mod;
      if (!command?.data?.toJSON) {
        console.warn(`⚠️  Commande ignorée au déploiement : ${full}`);
        continue;
      }
      out.push(command.data.toJSON());
    } catch (err) {
      console.error(`❌ Échec chargement commande ${full} :`, err.message);
    }
  }
  return out;
}

(async function main() {
  const commands = await collectCommands();
  if (!commands.length) {
    console.error("❌ Aucune commande à déployer.");
    process.exit(1);
  }
  const token = DISCORD_BOT_TOKEN;
  const clientId = DISCORD_CLIENT_ID;
  if (!token || !clientId) {
    console.error("❌ DISCORD_BOT_TOKEN et DISCORD_CLIENT_ID sont requis dans .env");
    process.exit(1);
  }
  const rest = new REST({ version: "10" }).setToken(token);
  const mode = process.env.MODE;
  const guildId = DISCORD_TEST_GUILD_ID;
  try {
    console.log(`🧪 Démarrage refresh de ${commands.length} commandes ${mode === "dev" && guildId ? "(guilde dev)" : "(global)"}...`);
    let data;
    if (mode === "dev" && guildId) {
      data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    } else {
      data = await rest.put(Routes.applicationCommands(clientId), { body: commands });
    }
    console.log(`✅ ${data.length} commandes slash déployées avec succès.`);
  } catch (err) {
    console.error("❌ Échec déploiement :", err);
    process.exit(1);
  }
})();
