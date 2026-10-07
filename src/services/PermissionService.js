const { PermissionFlagsBits } = require("discord.js");
const GuildConfigService = require("./GuildConfigService");
const { PERMISSION_FLAGS_MODERATION } = require("../config");

const GLOBAL_MODERATOR_ROLE_IDS = ["1459177196869652684"];

class PermissionService {
  async isModerator(member, guildId) {
    if (!member || !guildId) return false;
    try {
      const hasAdmin = member.permissions?.has?.(PermissionFlagsBits.Administrator);
      if (hasAdmin) return true;
      const hasManageGuild = member.permissions?.has?.(PermissionFlagsBits.ManageGuild);
      if (hasManageGuild) return true;
      const memberRoleIds = Array.isArray(member.roles?.cache?.map)
        ? member.roles.cache.map((r) => r.id)
        : [];
      if (GLOBAL_MODERATOR_ROLE_IDS.some((id) => memberRoleIds.includes(String(id)))) return true;
      const cfg = await GuildConfigService.getModeration(guildId);
      const roles = cfg?.modRoleIds || [];
      if (!roles.length) {
        for (const flag of PERMISSION_FLAGS_MODERATION) {
          if (member.permissions?.has?.(PermissionFlagsBits[flag])) return true;
        }
        return false;
      }
      return roles.some((roleId) => memberRoleIds.includes(String(roleId)));
    } catch (err) {
      console.error("PermissionService.isModerator error:", err.message);
      return false;
    }
  }

  async isExempt(member, guildId) {
    if (!member || !guildId) return false;
    const cfg = await GuildConfigService.getModeration(guildId);
    const exempt = cfg?.exemptRoleIds || [];
    if (!exempt.length) return false;
    const memberRoleIds = Array.isArray(member.roles?.cache?.map)
      ? member.roles.cache.map((r) => r.id)
      : [];
    return exempt.some((roleId) => memberRoleIds.includes(roleId));
  }
}

module.exports = new PermissionService();
