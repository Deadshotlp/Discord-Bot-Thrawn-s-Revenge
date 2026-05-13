function safeString(value) {
  return String(value || "").trim();
}

function toSnowflake(value) {
  const text = safeString(value);
  if (!text) {
    return "";
  }

  const match = text.match(/(\d{16,20})/);
  return match?.[1] || "";
}

export function normalizeReactionRoleBindings(rawBindings) {
  if (!Array.isArray(rawBindings)) {
    return [];
  }

  const normalized = [];

  for (const rawBinding of rawBindings) {
    if (!rawBinding || typeof rawBinding !== "object") {
      continue;
    }

    const messageId = toSnowflake(rawBinding.messageId);
    const roleId = toSnowflake(rawBinding.roleId);
    const channelId = toSnowflake(rawBinding.channelId);
    const emojiId = toSnowflake(rawBinding.emojiId);
    const emojiName = safeString(rawBinding.emojiName);

    if (!messageId || !roleId || (!emojiId && !emojiName)) {
      continue;
    }

    normalized.push({
      messageId,
      channelId,
      roleId,
      emojiId,
      emojiName
    });
  }

  const unique = new Map();
  for (const binding of normalized) {
    const emojiKey = binding.emojiId || binding.emojiName;
    unique.set(`${binding.messageId}:${emojiKey}`, binding);
  }

  return Array.from(unique.values());
}

export function parseEmojiInput(rawInput) {
  const input = safeString(rawInput);
  if (!input) {
    return null;
  }

  const customEmojiMatch = input.match(/^<a?:[^:>]{1,32}:(\d{16,20})>$/);
  if (customEmojiMatch) {
    return {
      emojiId: customEmojiMatch[1],
      emojiName: ""
    };
  }

  const snowflake = toSnowflake(input);
  if (snowflake) {
    return {
      emojiId: snowflake,
      emojiName: ""
    };
  }

  return {
    emojiId: "",
    emojiName: input
  };
}

export function buildBindingFromReaction({ channelId, messageId, roleId, reaction }) {
  const normalizedChannelId = toSnowflake(channelId);
  const normalizedMessageId = toSnowflake(messageId);
  const normalizedRoleId = toSnowflake(roleId);
  const emojiId = toSnowflake(reaction?.emoji?.id);
  const emojiName = safeString(reaction?.emoji?.name);

  if (!normalizedMessageId || !normalizedRoleId || (!emojiId && !emojiName)) {
    return null;
  }

  return {
    channelId: normalizedChannelId,
    messageId: normalizedMessageId,
    roleId: normalizedRoleId,
    emojiId,
    emojiName
  };
}

export function findReactionRoleBindingIndex(bindings, matcher) {
  const normalizedBindings = normalizeReactionRoleBindings(bindings);
  const messageId = toSnowflake(matcher?.messageId);
  const emojiId = toSnowflake(matcher?.emojiId);
  const emojiName = safeString(matcher?.emojiName);

  if (!messageId || (!emojiId && !emojiName)) {
    return -1;
  }

  return normalizedBindings.findIndex((binding) => {
    if (binding.messageId !== messageId) {
      return false;
    }

    if (emojiId) {
      return binding.emojiId === emojiId;
    }

    return !binding.emojiId && binding.emojiName === emojiName;
  });
}

export function findReactionRoleBindingsByReaction(bindings, messageId, reactionEmoji) {
  const normalizedBindings = normalizeReactionRoleBindings(bindings);
  const normalizedMessageId = toSnowflake(messageId);
  const emojiId = toSnowflake(reactionEmoji?.id);
  const emojiName = safeString(reactionEmoji?.name);

  if (!normalizedMessageId || (!emojiId && !emojiName)) {
    return [];
  }

  return normalizedBindings.filter((binding) => {
    if (binding.messageId !== normalizedMessageId) {
      return false;
    }

    if (emojiId) {
      return binding.emojiId === emojiId;
    }

    return !binding.emojiId && binding.emojiName === emojiName;
  });
}

export function formatBindingEmoji(binding) {
  if (binding.emojiId && binding.emojiName) {
    return `<:${binding.emojiName}:${binding.emojiId}>`;
  }

  if (binding.emojiId) {
    return `Emoji-ID ${binding.emojiId}`;
  }

  return binding.emojiName || "(unbekannt)";
}

export function parseReactionRoleMappingLines(rawInput) {
  const text = safeString(rawInput);
  if (!text) {
    return {
      entries: [],
      errors: ["Keine Mappings angegeben."]
    };
  }

  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries = [];
  const errors = [];

  for (const [index, line] of lines.entries()) {
    const match = line.match(/^(.+?)\s*(?:=|->|\|)\s*(.+)$/);
    if (!match) {
      errors.push(`Zeile ${index + 1}: Format muss \"Emoji = Rolle\" sein.`);
      continue;
    }

    const emojiToken = safeString(match[1]);
    const roleToken = safeString(match[2]);
    const roleIdMatch = roleToken.match(/\d{16,20}/);
    const roleId = roleIdMatch?.[0] || "";
    const emoji = parseEmojiInput(emojiToken);

    if (!emoji) {
      errors.push(`Zeile ${index + 1}: Emoji konnte nicht erkannt werden.`);
      continue;
    }

    if (!roleId) {
      errors.push(`Zeile ${index + 1}: Rolle fehlt oder ist ungültig.`);
      continue;
    }

    entries.push({
      emojiToken,
      roleId,
      emoji
    });
  }

  return { entries, errors };
}
