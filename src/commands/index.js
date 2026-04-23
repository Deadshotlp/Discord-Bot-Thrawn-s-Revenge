import { departmentCommand } from "./department.js";
import { rulesSetCommand } from "./rulesSet.js";
import { setupPanelCommand } from "./setupPanel.js";

export const commands = [setupPanelCommand, rulesSetCommand, departmentCommand];

export const commandMap = new Map(commands.map((command) => [command.data.name, command]));
