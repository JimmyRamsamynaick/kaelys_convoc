const Convocation = require("../models/Convocation");
const GuildConfigService = require("./GuildConfigService");
const ModLogService = require("./ModLogService");
const { CONVOC_STATUSES } = require("../config");

const CUSTOM_DETECTORS = [];

const USERID_FIELD_NAMES = [
  "utilisateur",
  "auteur",
  "ouvreur",
  "user id",
  "user",
  "membre",
  "client",
  "demandeur",
  "opener",
  "created by"
];

const USERID_REGEXES = [
  /<@!?(\d{17,20})>/,
  /(?:user\s*id|auteur|ouvreur|utilisateur|membre|demandeur|opener|créé\s*par)\s*[:=]?\s*(\d{17,20})/i,
  /(?:^|[^\d])(\d{17,20})(?:[^\d]|$)/
];

function extractUserIdsFromMessage(message) {
  const found = new Set();

  try {
    for (const [id] of (message.mentions?.users?.entries?.() || [])) found.add(id);
  } catch (_) {}
  if (message?.interaction?.user?.id) found.add(message.interaction.user.id);
  if (message?.author?.id && !message.author.bot) {
    // Auteur non-bot SSI nom de salon "look ticket" => pas fiable, on garde seulement si message a le flag "ticket-like détecté" en appelant.
    // Donc pas ajouté ici ; call-side décide.
  }

  const texts = [];
  if (typeof message.content === "string") texts.push(message.content);
  for (const emb of message.embeds || []) {
    const json = typeof emb.toJSON === "function" ? emb.toJSON() : emb;
    if (json?.author?.name) texts.push(json.author.name);
    if (json?.author?.url) texts.push(json.author.url);
    if (json?.author?.icon_url || json?.author?.iconURL) texts.push(json.author.icon_url || json.author.iconURL);
    if (json?.description) texts.push(json.description);
    if (json?.footer?.text) texts.push(json.footer.text);
    if (json?.footer?.icon_url || json?.footer?.iconURL) texts.push(json.footer.icon_url || json.footer.iconURL);
    if (json?.title) texts.push(json.title);
    if (json?.url) texts.push(json.url);
    for (const f of json?.fields || []) {
      texts.push(String(f.name || ""));
      texts.push(String(f.value || ""));
      const n = String(f.name || "").trim().toLowerCase().replace(/\s+/g, " ");
      const v = String(f.value || "").trim();
      if (USERID_FIELD_NAMES.some((name) => n.includes(name))) {
        for (const r of USERID_REGEXES) {
          const m = v.match(r);
          if (m && m[1]) found.add(m[1]);
        }
      }
    }
  }

  for (const line of texts) {
    for (const r of USERID_REGEXES) {
      const m = line.match(r);
      if (m && m[1]) found.add(m[1]);
    }
  }

  return [...found];
}

class TicketIntegration {
  constructor() {
    this.detectors = [];
    this.registerBuiltin();
  }

  registerBuiltin() {
    this.registerDetector({
      name: "channel-creation-ticket",
      description:
        "Channel privé nouvellement créé où le membre + au moins un rôle modérateur ont accès OU nom du salon contient 'ticket'.",
      detect: async ({ guild, user, channel, client }) => {
        if (!channel?.guild || channel.guild.id !== guild.id) return false;
        const cid = channel.isThread?.() ? channel.parentId : channel.id;
        const chan = await client.channels.fetch(cid).catch(() => null);
        if (!chan || !chan.permissionOverwrites) return false;
        const mod = await GuildConfigService.getModeration(guild.id);
        const modRoleIds = (mod?.modRoleIds || []).filter(Boolean);
        const allowUser = chan.permissionOverwrites.cache.get(user.id);
        if (allowUser?.allow?.toArray?.()?.includes("ViewChannel") === false && allowUser?.deny?.toArray?.()?.includes("ViewChannel")) return false;
        const hasUserAccess =
          allowUser?.allow?.has("ViewChannel") ||
          [0, 11, 12, 5, 15].includes(Number(chan.type));
        const hasModAccess = modRoleIds.some((rid) => {
          const ow = chan.permissionOverwrites.cache.get(rid);
          return ow?.allow?.has("ViewChannel");
        });
        const nameLooksTicket = /ticket|support|aide|help|verif/i.test(chan.name || "");
        if (hasUserAccess && (hasModAccess || nameLooksTicket)) return true;
        return false;
      }
    });

    this.registerDetector({
      name: "thread-in-ticket-forum",
      description: "Thread ouvert dans un forum/channel dont le nom ressemble à 'tickets'.",
      detect: async ({ guild, user, channel }) => {
        if (!channel?.guild) return false;
        const parent = await channel.guild.channels.fetch(channel.parentId).catch(() => null);
        if (!parent) return false;
        if (!/ticket|support|aide|help|verif/i.test(parent.name || "")) return false;
        const ownerId = channel.ownerId ?? (await channel.fetchOwner?.().catch(() => null))?.id;
        return ownerId === user.id;
      }
    });

    for (const d of CUSTOM_DETECTORS) this.registerDetector(d);
  }

  registerDetector(def) {
    if (!def?.name || typeof def.detect !== "function") {
      throw new Error("TicketIntegration.registerDetector : { name, detect(...) } requis.");
    }
    this.detectors.push(def);
  }

  looksLikeTicketChannel(channel, ticketsChannelId, ticketsCategoryId) {
    if (!channel) return false;
    if (String(ticketsChannelId) && String(channel.id) === String(ticketsChannelId)) return true;
    const parentIds = [];
    let cur = channel;
    while (cur) {
      if (cur.parentId) parentIds.push(cur.parentId);
      if (/ticket|support|aide|help|verif/i.test(cur.name || "")) return true;
      cur = cur.parent;
    }
    if (String(ticketsChannelId) && parentIds.includes(String(ticketsChannelId))) return true;
    if (String(ticketsCategoryId) && (String(channel.parentId) === String(ticketsCategoryId) || parentIds.includes(String(ticketsCategoryId)) || String(channel.id) === String(ticketsCategoryId))) {
      return true;
    }
    return false;
  }

  async userFulfilledAction({ guildId, userId, requiredAction, client, channel }) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { matched: false };
    if (requiredAction === "open_ticket") {
      for (const det of this.detectors) {
        try {
          const ok = await det.detect({ guild, user: { id: userId }, channel, client });
          if (ok) {
            const updated = await this.markPendingConvocationCompleted({
              guildId,
              userId,
              requiredAction: "open_ticket",
              client,
              completedVia: `detector:${det.name}`
            });
            return { matched: true, detector: det.name, convocations: updated };
          }
        } catch (_) {}
      }
    }
    return { matched: false };
  }

  async notifyTicketCreated({ guildId, userId, channelId, ticketId, client }) {
    const completed = await this.markPendingConvocationCompleted({
      guildId,
      userId,
      requiredAction: "open_ticket",
      client,
      completedVia: `manual-hook${ticketId ? `:${ticketId}` : ":channel:" + channelId}`
    });
    return { matched: completed.length > 0, userId, convocations: completed };
  }

  async resolveFromMessageUrl({ client, messageUrl }) {
    const m = String(messageUrl || "").match(/\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})$/);
    if (!m) throw new Error("URL de message Discord invalide.");
    const [, guildId, channelId, messageId] = m;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) throw new Error("Channel introuvable (10003).");
    const message = await channel.messages.fetch(messageId).catch((e) => {
      throw new Error("Message introuvable : " + e.message);
    });
    const userIds = extractUserIdsFromMessage(message);
    if (message?.author?.id && !message.author.bot && this.looksLikeTicketChannel(channel, null)) {
      userIds.unshift(message.author.id);
    }
    return {
      guildId,
      channelId,
      messageId,
      userIds: [...new Set(userIds)],
      message
    };
  }

  async scanTicketMessage({ client, message, explicitUserId = null }) {
    const guildId = message?.guildId;
    if (!guildId) return null;
    const userIds = new Set();
    if (explicitUserId) userIds.add(explicitUserId);
    for (const uid of extractUserIdsFromMessage(message)) userIds.add(uid);
    const results = [];
    for (const uid of [...userIds]) {
      const r = await this.userFulfilledAction({
        guildId,
        userId: uid,
        requiredAction: "open_ticket",
        client,
        channel: message.channel
      });
      if (r?.matched) results.push({ userId: uid, ...r });
    }
    return results;
  }

  async scanChannelForRecentTickets({ client, guildId, channelId, limit = 100, explicitTicketsChannelId = null, explicitTicketsCategoryId = null }) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) throw new Error("Salon introuvable.");
    if (!channel.isTextBased?.() && typeof channel.messages?.fetch !== "function") {
      throw new Error("Ce salon n'est pas textuel.");
    }
    if (!this.looksLikeTicketChannel(channel, explicitTicketsChannelId, explicitTicketsCategoryId)) {
      return [];
    }
    const msgs = await channel.messages.fetch({ limit: Math.min(100, Math.max(1, limit | 0)) }).catch(() => []);
    const out = [];
    for (const [, msg] of msgs) {
      const r = await this.scanTicketMessage({ client, message: msg }).catch(() => null);
      if (r?.length) out.push({ messageId: msg.id, matches: r });
    }
    return out;
  }

  _extractUserIdsFromChannelName(channel) {
    const out = new Set();
    const name = String(channel.name || "").normalize("NFKD");
    const reId = /(\d{17,})/g;
    let m;
    while ((m = reId.exec(name)) !== null) out.add(m[1]);
    const ticketPrefix = /^(?:ticket|tiket|tickets|verif|verification|convoc|support|aide|help|demande|contact)[_\-\s]*([^\s_]+)/i;
    const mt = name.match(ticketPrefix);
    if (mt && mt[1] && !mt[1].match(/^[0-9a-f]{24}$/i)) {
      const suffix = mt[1].toLowerCase();
      out.add(`__username_lookup:${suffix}__`);
    }
    return [...out];
  }

  _extractUserIdsFromChannelPermissionOverwrites(channel) {
    const out = new Set();
    try {
      const overwrites = channel.permissionOverwrites?.cache || channel.permissionOverwrites || [];
      const entries = overwrites.entries ? [...overwrites.entries()] : Object.entries(overwrites || {});
      for (const [id, ow] of entries) {
        if (!/^\d{17,}$/.test(String(id))) continue;
        const allow = ow.allow?.bitfield ?? ow.allow ?? 0n;
        const deny = ow.deny?.bitfield ?? ow.deny ?? 0n;
        const VIEW_CHANNEL = 1024n;
        const hasView = (BigInt(allow) & VIEW_CHANNEL) === VIEW_CHANNEL && (BigInt(deny) & VIEW_CHANNEL) !== VIEW_CHANNEL;
        if (hasView) out.add(String(id));
      }
    } catch (_) {}
    return [...out];
  }

  async detectUserFromTicketChannel({ client, channel }) {
    const candidates = new Set();

    // 0. Nom du channel : "ticket-880130612609032253", "ticket-starness", "verif-starness", "support-starness#1234", ...
    for (const x of this._extractUserIdsFromChannelName(channel)) candidates.add(x);

    // 1. Overwrites ViewChannel (cas le plus fréquent : channel privé, seul l'user + staff peuvent voir)
    for (const uid of this._extractUserIdsFromChannelPermissionOverwrites(channel)) candidates.add(uid);

    // 2. Owner du thread / Owner du ticket
    try {
      if (channel.isThread?.() || typeof channel.fetchOwner === "function") {
        const owner = await channel.fetchOwner?.().catch(() => null);
        const ownerId = owner?.id || channel.ownerId;
        if (ownerId) candidates.add(String(ownerId));
      }
    } catch (_) {}

    // 3. Dernier message / messages récents (non-bot) dans le channel
    try {
      if (channel.isTextBased?.() && typeof channel.messages?.fetch === "function") {
        const msgs = await channel.messages.fetch({ limit: 50 }).catch(() => []);
        for (const [, m] of msgs) {
          if (!m.author?.bot && m.author?.id) candidates.add(String(m.author.id));
          for (const uid of extractUserIdsFromMessage(m)) candidates.add(String(uid));
        }
      }
    } catch (_) {}

    // 4. Members du thread (thread members)
    try {
      if (typeof channel.members?.fetch === "function") {
        const members = await channel.members.fetch().catch(() => []);
        for (const [id] of members || []) candidates.add(String(id));
      }
    } catch (_) {}

    // 5. Résolution des username_lookup : suffixes type "starness" dans ticket-starness
    const guildId = channel.guild?.id;
    if (guildId) {
      const lookups = [...candidates].filter((x) => x.startsWith("__username_lookup:"));
      const suffixes = lookups.map((x) => x.replace("__username_lookup:", "").replace(/__$/, ""));
      if (suffixes.length) {
        try {
          for (const s of suffixes) candidates.delete(`__username_lookup:${s}__`);
          const guild = await client.guilds.fetch(guildId).catch(() => null);
          if (guild) {
            let members = null;
            try {
              members = await guild.members.fetch({ limit: 400 }).catch(() => new Map());
            } catch (_) {}
            if (!members) members = new Map();
            if (members.size === 0) {
              try {
                const all = await guild.members.list?.({ limit: 400 }).catch(() => []);
                if (all?.forEach) all.forEach((m) => members.set(m.id, m));
              } catch (_) {}
            }
            for (const suffix of suffixes) {
              for (const [, m] of members) {
                const names = [
                  m.user?.username,
                  m.user?.displayName,
                  m.user?.globalName,
                  m.nickname,
                  m.displayName
                ].filter(Boolean).map((x) => String(x).toLowerCase().normalize("NFKD"));
                if (names.some((n) => n === suffix || n.replace(/[\s_\-]/g, "") === suffix.replace(/[\s_\-]/g, ""))) {
                  candidates.add(String(m.id));
                  break;
                }
              }
            }
          }
        } catch (_) {}
      }
    }

    // 6. Retire __username_lookup non résolus, et ne garde que des IDs Discord valides.
    const final = new Set();
    for (const c of candidates) {
      if (typeof c !== "string") continue;
      if (/^\d{17,}$/.test(c)) final.add(c);
    }
    return [...final];
  }

  async resolveChannelTicketForAllUsers({ client, channel, backfill = false }) {
    const guildId = channel.guild?.id;
    if (!guildId) return { matched: false };
    const userIds = await this.detectUserFromTicketChannel({ client, channel });
    const completed = [];
    for (const uid of userIds) {
      const done = await this.markPendingConvocationCompleted({
        guildId,
        userId: uid,
        requiredAction: "open_ticket",
        client,
        completedVia: backfill ? `category-backfill·#${channel.name || channel.id}` : `channel-event·#${channel.name || channel.id}`,
        actorId: null
      });
      if (done?.length) completed.push(...done);
    }
    return { matched: completed.length > 0, userIds, completed };
  }

  async _resolveByFetchingChannelIdDirectViaREST({ client, guildId, channelId }) {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch) return null;
    if (!ch.guildId && ch.guild?.id !== guildId) return null;
    return this.resolveChannelTicketForAllUsers({ client, channel: ch }).catch(() => null);
  }

  async _resolvePendingOpenTicketsForGuildViaGuess({ client, guildId }) {
    const Convocation = require("../models/Convocation");
    const pending = await Convocation.find({
      guildId,
      status: "pending",
      requiredAction: "open_ticket"
    }).lean();
    if (!pending?.length) return { found: 0, resolved: 0 };
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { found: pending.length, resolved: 0 };
    const cfg = await require("./GuildConfigService").getOrCreate(guildId);
    const categoryId = cfg?.moderation?.ticketsCategoryId || null;
    let channels = new Map();
    try {
      channels = await guild.channels.fetch({ withThreads: true, force: true }).catch(() => new Map());
    } catch (_) {}
    const candidates = [];
    for (const [id, ch] of channels) {
      if (this.looksLikeTicketChannel(ch, cfg?.moderation?.ticketsChannelId || null, categoryId)) {
        candidates.push(ch);
      }
    }
    const resolvedIds = new Set();
    for (const ch of candidates) {
      try {
        const r = await this.resolveChannelTicketForAllUsers({ client, channel: ch, backfill: true }).catch(() => null);
        if (r?.completed?.length) {
          for (const c of r.completed) resolvedIds.add(String(c._id || c.id));
        }
      } catch (_) {}
    }
    // Dernier fallback : pour chaque convocation pending, on tenter REST fetch individuel si on a l'id du ticket (on ne l'a pas, on cherche par userId dans les channels en utilisant leur nom/overwrites).
    return { found: pending.length, resolved: resolvedIds.size, ids: [...resolvedIds] };
  }

  async autoResolveFromTicketCategory({ client, guildId, categoryId, maxChannels = 300, backfill = false }) {
    const scannedChannels = [];
    const resolvedTickets = [];
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { scanned: 0, resolved: 0, scannedChannels, resolvedTickets };

    let channels = await guild.channels.fetch().catch(() => new Map());
    try {
      const full = await guild.channels.fetch({ withThreads: true, force: true }).catch(() => null);
      if (full?.size) channels = full;
    } catch (_) {}

    const channelList = [...channels.values()].filter(Boolean);
    let processed = 0;
    for (const ch of channelList) {
      if (processed >= Math.max(1, maxChannels | 0)) break;
      if (!this.looksLikeTicketChannel(ch, null, categoryId)) continue;
      scannedChannels.push({ id: ch.id, name: ch.name, type: ch.type });
      processed++;
      try {
        const r = await this.resolveChannelTicketForAllUsers({ client, channel: ch, backfill });
        if (r.completed?.length) resolvedTickets.push({ channelId: ch.id, ...r });
      } catch (_) {}
    }

    try {
      const ModLogService = require("./ModLogService");
      await ModLogService.write(client, {
        guildId,
        type: backfill ? "ticket.category_backfill" : "ticket.category_scan",
        issuerId: client.user.id,
        details: {
          categoryId,
          scanned: scannedChannels.length,
          resolvedTotal: resolvedTickets.reduce((a, b) => a + (b.completed?.length || 0), 0),
          channels: scannedChannels.map((c) => `${c.name || "?"}(${c.id})`).slice(0, 40)
        }
      }).catch(() => null);
    } catch (_) {}

    return {
      scanned: scannedChannels.length,
      resolved: resolvedTickets.reduce((a, b) => a + (b.completed?.length || 0), 0),
      scannedChannels,
      resolvedTickets
    };
  }

  async markPendingConvocationCompleted({
    guildId,
    userId,
    requiredAction,
    client,
    completedVia = "manual",
    actorId = null,
    convocationId = null,
    notifyInChannel = false,
    reasonKey = null,
    force = false
  }) {
    const filter = {
      guildId,
      status: CONVOC_STATUSES.PENDING
    };
    if (convocationId) {
      if (mongoose.isValidObjectId?.(convocationId)) filter._id = new mongoose.Types.ObjectId(convocationId);
      else filter._id = convocationId;
    } else {
      if (userId) filter.userId = userId;
      if (requiredAction) filter.requiredAction = requiredAction;
      if (reasonKey) filter.reasonKey = reasonKey;
    }

    const rawDocs = await Convocation.find(filter).lean();
    const docs = force
      ? rawDocs
      : rawDocs.filter((c) => c.status === CONVOC_STATUSES.PENDING);

    if (!docs.length) {
      console.warn(
        "[TicketIntegration] markPendingConvocationCompleted : 0 document match pour filter=",
        JSON.stringify(filter),
        "convocationId=",
        convocationId ?? "—",
        "userId=",
        userId ?? "—",
        "requiredAction=",
        requiredAction ?? "—",
        "reasonKey=",
        reasonKey ?? "—"
      );
      return [];
    }

    const updated = [];
    const now = new Date();
    for (const c of docs) {
      try {
        const patch = {
          status: CONVOC_STATUSES.COMPLETED,
          completedAt: now,
          completedVia,
          completedBy: actorId,
          resolvedBy: actorId || c.userId,
          resolutionNote: completedVia
        };
        const refreshed = await Convocation.findOneAndUpdate(
          { _id: c._id, status: CONVOC_STATUSES.PENDING },
          { $set: patch },
          { new: true, runValidators: true, setDefaultsOnInsert: false }
        ).lean();
        if (!refreshed || refreshed.status !== CONVOC_STATUSES.COMPLETED) {
          console.warn(
            "[TicketIntegration] findOneAndUpdate n'a pas appliqué le statut sur _id=" +
              c._id +
              " refreshed=" +
              JSON.stringify(refreshed)
          );
          continue;
        }
        updated.push(refreshed);
      } catch (err) {
        console.error("[TicketIntegration] update échouée _id=" + c._id, err.message);
      }
    }

    for (const c of updated) {
      try {
        await ModLogService.write(client, {
          guildId,
          type: "convocation.completed",
          targetUser: { id: c.userId || userId },
          issuer: actorId ? { id: actorId } : { id: c.issuerId },
          channelId: c.channelId,
          convocationId: c._id,
          details: {
            reasonKey: c.reasonKey,
            reasonLabel: c.reasonLabel,
            requiredAction: c.requiredAction,
            completedVia,
            completedAt: c.completedAt || now,
            deadlineAt: c.deadlineAt,
            channelId: c.channelId,
            issuerId: c.issuerId,
            matchedCount: updated.length
          }
        });
      } catch (_) {}
      if (notifyInChannel && c.channelId) {
        try {
          const ch = await client.channels.fetch(c.channelId).catch(() => null);
          if (ch?.isTextBased?.() && ch.permissionsFor?.(client.user)?.has("SendMessages")) {
            const { EmbedBuilder } = require("discord.js");
            const { formatDate, EMBED_COLORS } = require("../config");
            const embed = new EmbedBuilder()
              .setColor(EMBED_COLORS.SUCCESS)
              .setTitle("✅ Convocation honorée")
              .addFields(
                { name: "👤 Membre", value: `<@${c.userId}>`, inline: true },
                { name: "📋 Motif", value: c.reasonLabel || c.reasonKey, inline: true },
                { name: "🎯 Action requise", value: c.requiredAction || "—", inline: true },
                { name: "📅 Date convocation", value: formatDate(c.createdAt), inline: true },
                { name: "🎟️ Résolue via", value: String(completedVia).slice(0, 1024), inline: true },
                { name: "🕒 Résolue le", value: formatDate(now), inline: true }
              )
              .setFooter({ text: `ID convocation : ${c._id}` })
              .setTimestamp(now);
            let target;
            if (c.messageId) target = ch.messages.fetch(c.messageId).catch(() => null);
            const ref = await target;
            if (ref) {
              await ref
                .reply({
                  embeds: [embed],
                  allowedMentions: { users: [], roles: [], parse: [] }
                })
                .catch(() =>
                  ch.send({ embeds: [embed], allowedMentions: { users: [], roles: [], parse: [] } }).catch(() => null)
                );
            } else {
              await ch.send({ embeds: [embed], allowedMentions: { users: [], roles: [], parse: [] } }).catch(() => null);
            }
          }
        } catch (_) {}
      }
    }

    console.log(
      "[TicketIntegration] markPendingConvocationCompleted terminé filter=" +
        JSON.stringify(filter) +
        " matched_raw=" +
        rawDocs.length +
        " modified=" +
        updated.length
    );
    return updated;
  }
}

const instance = new TicketIntegration();

module.exports = instance;
module.exports.extractUserIdsFromMessage = extractUserIdsFromMessage;
module.exports.registerExternalDetector = (def) => {
  if (typeof def?.detect === "function") CUSTOM_DETECTORS.push(def);
};
