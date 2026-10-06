const mongoose = require("mongoose");
const { DEFAULT_MODERATION_CONFIG } = require("../config");

const ReasonSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    message: { type: String, required: true },
    deadlineMs: { type: Number, default: null, min: 0 },
    requiredAction: { type: String, default: "custom" },
    reminderOffsetsMs: { type: [Number], default: [] },
    sanctionIfExpired: {
      type: new mongoose.Schema(
        {
          type: { type: String, enum: ["none", "ban", "kick", "mute", "timeout", "warn"], default: "none" },
          durationMs: { type: Number, default: undefined, min: 0 },
          reason: { type: String, default: "Convocation non respectée." }
        },
        { _id: false }
      )
    }
  },
  { _id: false, strict: false }
);

const ModerationSchema = new mongoose.Schema(
  {
    convocationChannelId: { type: String, default: null },
    logsChannelId: { type: String, default: null },
    ticketsChannelId: { type: String, default: null },
    ticketsCategoryId: { type: String, default: null },
    modRoleIds: { type: [String], default: [] },
    exemptRoleIds: { type: [String], default: [] },
    reasons: { type: Map, of: ReasonSchema, default: () => DEFAULT_MODERATION_CONFIG.reasons }
  },
  { _id: false }
);

const GuildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    moderation: { type: ModerationSchema, default: () => ({ ...DEFAULT_MODERATION_CONFIG }) }
  },
  { timestamps: true, minimize: false }
);

GuildConfigSchema.statics.ensureDefaultReasons = function (doc) {
  if (!doc?.moderation?.reasons) return doc;
  const reasons = doc.moderation.reasons;
  const defaults = DEFAULT_MODERATION_CONFIG.reasons;
  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (!reasons.has(key)) {
      reasons.set(key, value);
      changed = true;
    }
  }
  if (changed) doc.markModified("moderation.reasons");
  return doc;
};

GuildConfigSchema.pre("save", function (next) {
  this.constructor.ensureDefaultReasons(this);
  next();
});

module.exports = mongoose.models.GuildConfig || mongoose.model("GuildConfig", GuildConfigSchema);
