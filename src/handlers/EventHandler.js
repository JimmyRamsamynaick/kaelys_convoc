const path = require("path");
const fs = require("fs");

class EventHandler {
  constructor(client, eventsDir) {
    this.client = client;
    this.eventsDir = eventsDir;
    this.loaded = [];
  }

  load() {
    const absolute = path.resolve(this.eventsDir);
    const files = fs.readdirSync(absolute).filter((f) => f.endsWith(".js"));
    for (const file of files) {
      const full = path.join(absolute, file);
      try {
        const mod = require(full);
        const event = mod.default || mod;
        if (!event?.name || typeof event.execute !== "function") {
          console.warn(`⚠️  Événement ignoré : ${file}`);
          continue;
        }
        const listener = (...args) => event.execute(this.client, ...args);
        if (event.once) this.client.once(event.name, listener);
        else this.client.on(event.name, listener);
        this.loaded.push(event.name);
        console.log(`🔗 Événement chargé : ${event.name}${event.once ? " (once)" : ""}`);
      } catch (err) {
        console.error(`❌ Échec chargement événement ${file} :`, err.message);
      }
    }
    return this.loaded;
  }
}

module.exports = EventHandler;
