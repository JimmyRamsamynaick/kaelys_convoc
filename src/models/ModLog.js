const mongoose = require("mongoose");

const ModLogSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    type: {
      type: String,
      required: true,
      enum: [
        "convocation.created",
        "convocation.completed",
        "convocation.expired",
        "convocation.sanctioned",
        "convocation.cancelled",
        "convocation.reminder",
        "convocation.sanction_failed",
        "guild_config.updated",
        "sanction.ban",
        "sanction.kick",
        "sanction.mute",
        "sanction.warn"
      ],
      index: true
    },
    targetUserId: { type: String, default: null },
    targetUserTag: { type: String, default: null },
    issuerId: { type: String, default: null },
    issuerTag: { type: String, default: null },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    convocationId: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "Convocation" },
    details: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    createdAt: { type: Date, required: true, default: Date.now, index: true }
  },
  { minimize: false }
);

ModLogSchema.index({ guildId: 1, createdAt: -1 });

module.exports = mongoose.models.ModLog || mongoose.model("ModLog", ModLogSchema);
