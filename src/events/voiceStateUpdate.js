import { sendLog } from "../features/logging/logDispatcher.js";
import { sendBotPing } from "../features/logging/logDispatcher.js";
import { getAllDepartmentRoleIds } from "../features/departments/service.js";

function isSameChannel(oldState, newState) {
  return oldState.channelId === newState.channelId;
}

export async function handleVoiceStateUpdate(oldState, newState) {
  const settings = newState.client.botContext.guildSettingsRepository.getByGuildId(newState.guild.id);

  if (newState.member?.user?.bot) {
    return;
  }

  if (isSameChannel(oldState, newState)) {
    return;
  }

  const member = newState.member || oldState.member;
  if (!member) {
    return;
  }

  if (!oldState.channelId && newState.channelId) {
    await sendLog(
      newState.guild,
      `:microphone2: **Voice Join** ${member.user.tag} ist <#${newState.channelId}> beigetreten.`,
      "voice"
    );

    if (settings?.support_waiting_voice_channel_id && newState.channelId === settings.support_waiting_voice_channel_id) {
      const supportRoles = getAllDepartmentRoleIds(settings);

      const roleMentions = [...new Set(supportRoles)].map((id) => `<@&${id}>`).join(" ");

      await sendBotPing(
        newState.guild,
        `:bell: User <@${member.id}> wartet im Support-Warteraum <#${newState.channelId}>. ${roleMentions}`,
        {
          allowedMentions: {
            parse: [],
            users: [member.id],
            roles: supportRoles
          }
        }
      );
    }

    return;
  }

  if (oldState.channelId && !newState.channelId) {
    await sendLog(
      newState.guild,
      `:mute: **Voice Leave** ${member.user.tag} hat <#${oldState.channelId}> verlassen.`,
      "voice"
    );
    return;
  }

  await sendLog(
    newState.guild,
    `:twisted_rightwards_arrows: **Voice Switch** ${member.user.tag} wechselte von <#${oldState.channelId}> nach <#${newState.channelId}>.`,
    "voice"
  );
}
