const GuildConfig = require("../models/GuildConfig");
const { DEFAULT_MODERATION_CONFIG } = require("../config");

const cache = new Map();

const getReasonsPlain = (reasons) => {
  const obj = {};
  if (reasons instanceof Map) {
    for (const [key, value] of reasons.entries()) obj[key] = value;
  } else if (reasons && typeof reasons === "object") {
    for (const [key, value] of Object.entries(reasons)) obj[key] = value;
  }
  for (const [k, v] of Object.entries(DEFAULT_MODERATION_CONFIG.reasons)) {
    if (!obj[k]) obj[k] = v;
  }
  return obj;
};

const ensureReasonsMap = (reasons) => {
  if (reasons instanceof Map) return reasons;
  const map = new Map();
  if (reasons && typeof reasons === "object") {
    for (const [k, v] of Object.entries(reasons)) map.set(k, v);
  }
  for (const [k, v] of Object.entries(DEFAULT_MODERATION_CONFIG.reasons)) {
    if (!map.has(k)) map.set(k, v);
  }
  return map;
};

class GuildConfigService {
  constructor() {
    this.cache = cache;
  }

  _cacheKey(guildId) {
    return `cfg:${guildId}`;
  }

  async getOrCreate(guildId) {
    const key = this._cacheKey(guildId);
    if (this.cache.has(key)) return this.cache.get(key);
    let doc = await GuildConfig.findOne({ guildId }).lean();
    if (!doc) {
      const created = await GuildConfig.create({ guildId });
      doc = created.toObject();
    }
    doc.moderation.reasons = getReasonsPlain(doc.moderation.reasons);
    this.cache.set(key, doc);
    return doc;
  }

  async getModeration(guildId) {
    const cfg = await this.getOrCreate(guildId);
    return cfg.moderation;
  }

  async getReasons(guildId) {
    const mod = await this.getModeration(guildId);
    return mod.reasons;
  }

  async update(guildId, patchFn) {
    let doc = await GuildConfig.findOne({ guildId });
    if (!doc) doc = await GuildConfig.create({ guildId });
    doc.moderation.reasons = ensureReasonsMap(doc.moderation.reasons);
    await patchFn(doc);
    await doc.save();
    const updated = await GuildConfig.findOne({ guildId }).lean();
    updated.moderation.reasons = getReasonsPlain(updated.moderation.reasons);
    this.cache.set(this._cacheKey(guildId), updated);
    return updated;
  }

  async setModerationField(guildId, field, value) {
    return this.update(guildId, (doc) => {
      doc.moderation[field] = value;
    });
  }

  async setReason(guildId, reasonKey, reasonData) {
    return this.update(guildId, (doc) => {
      const current = doc.moderation.reasons.get(reasonKey) || {};
      doc.moderation.reasons.set(reasonKey, { ...current, ...reasonData });
    });
  }

  invalidateCache(guildId) {
    this.cache.delete(this._cacheKey(guildId));
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = new GuildConfigService();
