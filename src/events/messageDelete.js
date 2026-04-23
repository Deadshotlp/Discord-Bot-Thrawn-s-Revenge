import { sendLog } from "../features/logging/logDispatcher.js";

export async function handleMessageDelete(message) {
  if (!message.guild) {
    return;
  }

  if (message.partial) {
    try {
      await message.fetch();
    } catch {
      return;
    }
  }

  if (message.author?.bot) {
    return;
  }

  const content = message.content?.trim() ? message.content.slice(0, 500) : "(kein Textinhalt)";
  const authorTag = message.author?.tag || "Unbekannt";

  await sendLog(
    message.guild,
    `:wastebasket: **Message Delete** in <#${message.channel.id}> von ${authorTag}: ${content}`,
    "message"
  );
}
