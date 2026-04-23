import { botInfoCommand } from "./commands/botInfo.js";
import { pingCommand } from "./commands/ping.js";

export const systemModule = {
  name: "system",
  commands: [pingCommand, botInfoCommand],
  events: {}
};
