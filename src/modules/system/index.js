import { botInfoCommand } from "./commands/botInfo.js";
import { pingCommand } from "./commands/ping.js";

export const systemModule = {
  name: "system",
  defaultEnabled: true,
  defaultConfig: {},
  commands: [pingCommand, botInfoCommand],
  events: {}
};
