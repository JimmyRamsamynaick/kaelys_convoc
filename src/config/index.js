require('dotenv').config();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const DEFAULT_CONVOC_REASONS = {
  verification: {
    label: "Vérification",
    message:
      "Vous devez ouvrir un ticket auprès de l'équipe de modération afin de procéder à la vérification de votre compte.",
    deadlineMs: 24 * HOUR,
    requiredAction: "open_ticket",
    reminderOffsetsMs: [12 * HOUR, 1 * HOUR],
    sanctionIfExpired: {
      type: "ban",
      reason: "Convocation de vérification non respectée (délai dépassé)."
    }
  },
  convocation: {
    label: "Convocation",
    message:
      "Vous êtes convoqué par l'équipe de modération. Merci de contacter un membre de l'équipe de modération dans le délai imparti.",
    deadlineMs: 48 * HOUR,
    requiredAction: "contact_staff",
    reminderOffsetsMs: [24 * HOUR, 2 * HOUR],
    sanctionIfExpired: {
      type: "mute",
      durationMs: 24 * HOUR,
      reason: "Convocation non respectée."
    }
  },
  moderation: {
    label: "Modération",
    message:
      "Vous êtes convoqué par l'équipe de modération concernant votre comportement sur le serveur.",
    deadlineMs: 24 * HOUR,
    requiredAction: "contact_staff",
    reminderOffsetsMs: [12 * HOUR, 1 * HOUR],
    sanctionIfExpired: {
      type: "kick",
      reason: "Convocation de modération non respectée."
    }
  },
  entretien: {
    label: "Entretien",
    message:
      "Vous êtes convoqué pour un entretien avec l'équipe du serveur. Merci de rejoindre le vocal de modération prévu à cet effet dans le délai indiqué.",
    deadlineMs: 24 * HOUR,
    requiredAction: "join_voice",
    reminderOffsetsMs: [12 * HOUR, 1 * HOUR],
    sanctionIfExpired: null
  },
  autre: {
    label: "Autre",
    message:
      "Vous êtes convoqué par l'équipe du serveur. Merci de vous rendre disponible rapidement.",
    deadlineMs: 48 * HOUR,
    requiredAction: "custom",
    reminderOffsetsMs: [24 * HOUR],
    sanctionIfExpired: null
  }
};

const DEFAULT_MODERATION_CONFIG = {
  convocationChannelId: null,
  logsChannelId: null,
  ticketsChannelId: null,
  ticketsCategoryId: null,
  modRoleIds: [],
  exemptRoleIds: [],
  reasons: DEFAULT_CONVOC_REASONS
};

const CONVOC_STATUSES = Object.freeze({
  PENDING: "pending",
  COMPLETED: "completed",
  EXPIRED: "expired",
  SANCTIONED: "sanctioned",
  CANCELLED: "cancelled"
});

const ALLOWED_SANCTION_TYPES = Object.freeze([
  "none",
  "ban",
  "kick",
  "mute",
  "timeout",
  "warn"
]);

const ALLOWED_REQUIRED_ACTIONS = Object.freeze([
  "open_ticket",
  "contact_staff",
  "join_voice",
  "reply_in_channel",
  "custom"
]);

const PERMISSION_FLAGS_MODERATION = Object.freeze([
  "Administrator",
  "ManageGuild",
  "ManageMessages",
  "ModerateMembers"
]);

const EMBED_COLORS = Object.freeze({
  SUCCESS: 0x2bbf7a,
  DANGER: 0xe74c3c,
  WARNING: 0xf1c40f,
  INFO: 0x3498db,
  CONVOC: 0x6c5ce7
});

const LOCALE = process.env.LOCALE || "fr-FR";
const TIMEZONE = process.env.TIMEZONE || "Europe/Paris";

const formatDate = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  try {
    return new Intl.DateTimeFormat(LOCALE, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: TIMEZONE
    }).format(d);
  } catch (_) {
    return d.toLocaleString();
  }
};

module.exports = {
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
  DISCORD_TEST_GUILD_ID: process.env.DISCORD_TEST_GUILD_ID,
  MONGO_URI: process.env.MONGO_URI,
  LOCALE,
  TIMEZONE,
  DEFAULT_CONVOC_REASONS,
  DEFAULT_MODERATION_CONFIG,
  CONVOC_STATUSES,
  ALLOWED_SANCTION_TYPES,
  ALLOWED_REQUIRED_ACTIONS,
  PERMISSION_FLAGS_MODERATION,
  EMBED_COLORS,
  HOUR,
  DAY,
  formatDate
};
