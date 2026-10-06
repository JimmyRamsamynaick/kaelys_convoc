const { PermissionFlagsBits } = require("discord.js");
const GuildConfigService = require("./GuildConfigService");
const { PERMISSION_FLAGS_MODERATION } = require("../config");

class PermissionService {
  async isModerator(member, guildId) {
    if (!member || !guildId) return false;
    try {
      const hasAdmin = member.permissions?.has?.(PermissionFlagsBits.Administrator);
      if (hasAdmin) return true;
      const hasManageGuild = member.permissions?.has?.(PermissionFlagsBits.ManageGuild);
      if (hasManageGuild) return true;
      const cfg = await GuildConfigService.getModeration(guildId);
      const roles = cfg?.modRoleIds || [];
      if (!roles.length) {
        for (const flag of PERMISSION_FLAGS_MODERATION) {
          if (member.permissions?.has?.(PermissionFlagsBits[flag])) return true;
        }
        return false;
      }
      const memberRoleIds = Array.isArray(member.roles?.cache?.map)
        ? member.roles.cache.map((r) => r.id)
        : [];
      return roles.some((roleId) => memberRoleIds.includes(roleId));
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
