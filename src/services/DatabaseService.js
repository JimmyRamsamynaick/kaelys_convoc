const mongoose = require("mongoose");
const { MONGO_URI } = require("../config");

class DatabaseService {
  constructor() {
    this.connected = false;
    this.retryCount = 0;
    this.maxRetries = 5;
  }

  async connect() {
    if (this.connected && mongoose.connection.readyState === 1) return;
    this.maxRetries = 2;
    if (!MONGO_URI) {
      throw new Error(
        "MONGO_URI est absent de l'environnement. Ajoutez-le dans votre fichier .env."
      );
    }
    try {
      await mongoose.connect(MONGO_URI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000
      });
      this.connected = true;
      this.retryCount = 0;
      console.log("✅ MongoDB connectée avec succès.");
      mongoose.connection.on("disconnected", () => {
        console.warn("⚠️  Connexion MongoDB perdue — tentative de reconnexion...");
        this.connected = false;
      });
      mongoose.connection.on("reconnected", () => {
        this.connected = true;
        console.log("✅ MongoDB reconnectée.");
      });
    } catch (error) {
      this.retryCount += 1;
      console.error(`❌ Échec connexion MongoDB (tentative ${this.retryCount}/${this.maxRetries}) :`, error.message);
      if (this.retryCount < this.maxRetries) {
        const delayMs = Math.min(1000 * 2 ** this.retryCount, 15000);
        await new Promise((r) => setTimeout(r, delayMs));
        return this.connect();
      }
      throw error;
    }
  }

  async disconnect() {
    if (!this.connected) return;
    await mongoose.disconnect();
    this.connected = false;
    console.log("🔌 Déconnecté de MongoDB.");
  }
}

module.exports = new DatabaseService();
