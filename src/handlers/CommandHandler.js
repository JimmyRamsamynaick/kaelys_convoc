const path = require("path");
const fs = require("fs");

class CommandHandler {
  constructor(client, commandsDir) {
    this.client = client;
    this.commandsDir = commandsDir;
    this.commands = new Map();
  }

  async load() {
    const absolute = path.resolve(this.commandsDir);

    function walk(dir) {
      const out = [];
      const stack = [dir];
      while (stack.length) {
        const cur = stack.pop();
        let entries;
        try {
          entries = fs.readdirSync(cur, { withFileTypes: true });
        } catch (_) {
          continue;
        }
        for (const e of entries) {
          const full = path.join(cur, e.name);
          if (e.isDirectory()) {
            stack.push(full);
          } else if (e.isFile() && e.name.endsWith(".js")) {
            out.push(full);
          }
        }
      }
      return out;
    }

    const entries = walk(absolute);
    for (const full of entries) {
      try {
        delete require.cache[require.resolve(full)];
        const mod = require(full);
        const command = mod.default || mod;
        if (!command?.data?.name) {
          console.warn(`⚠️  Commande ignorée (sans data.name) : ${full}`);
          continue;
        }
        this.commands.set(command.data.name, command);
        console.log(`📥 Commande chargée : /${command.data.name}`);
      } catch (err) {
        console.error(`❌ Échec chargement commande ${full} :`, err.message);
      }
    }
    return this.commands;
  }

  async handle(interaction) {
    if (!interaction.isChatInputCommand?.() && !interaction.isAutocomplete?.()) return;
    const name = interaction.commandName;
    const command = this.commands.get(name);
    if (!command) return;
    try {
      if (interaction.isAutocomplete?.()) {
        if (typeof command.autocomplete === "function") {
          const resp = await Promise.resolve(command.autocomplete(interaction));
          if (!interaction.replied && !interaction.deferred && Array.isArray(resp)) {
            await interaction.respond(resp.slice(0, 25)).catch(() => null);
          }
        }
        return;
      }
      await Promise.resolve(command.execute(interaction, this.client));
    } catch (err) {
      console.error(`❌ Commande /${name} a échoué :`, err);
      const content = "❌ Une erreur inattendue est survenue lors de l'exécution de la commande. L'incident est logué.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content, embeds: [], components: [] }).catch(() => null);
      } else {
        await interaction.reply({ content, flags: 64 }).catch(() => null);
      }
    }
  }
}

module.exports = CommandHandler;
