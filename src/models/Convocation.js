const mongoose = require("mongoose");
const { CONVOC_STATUSES } = require("../config");

const ConvocationSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    reasonKey: { type: String, required: true },
    reasonLabel: { type: String, required: true },
    customDetails: { type: String, default: null },
    requiredAction: { type: String, default: "custom" },
    messageSent: { type: String, default: null },
    createdAt: { type: Date, required: true, default: Date.now, index: true },
    deadlineAt: { type: Date, default: null, index: true },
    completedAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
    sanctionedAt: { type: Date, default: null },
    reminderTimestamps: { type: [Date], default: [] },
    status: {
      type: String,
      required: true,
      enum: Object.values(CONVOC_STATUSES),
      default: CONVOC_STATUSES.PENDING,
      index: true
    },
    sanctionIfExpired: {
      type: new mongoose.Schema(
        {
          type: {
            type: String,
            enum: ["none", "ban", "kick", "mute", "timeout", "warn"],
            default: "none"
          },
          durationMs: { type: Number, default: undefined },
          reason: { type: String, default: "Convocation non respectée." }
        },
        { _id: false }
      )
    },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    issuerId: { type: String, required: true },
    resolvedBy: { type: String, default: null },
    resolutionNote: { type: String, default: null },
    failureLog: { type: String, default: null }
  },
  { timestamps: true }
);

ConvocationSchema.index({ guildId: 1, userId: 1, status: 1 });
ConvocationSchema.index({ status: 1, deadlineAt: 1 });

module.exports = mongoose.models.Convocation || mongoose.model("Convocation", ConvocationSchema);
