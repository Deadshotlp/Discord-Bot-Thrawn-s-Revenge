import { setupModule } from "./setup/index.js";
import { supportModule } from "./support/index.js";
import { verifyModule } from "./verify/index.js";
import { systemModule } from "./system/index.js";
import { reactionRoleModule } from "./reactionRole/index.js";
import { contentCreatorModule } from "./contentCreator/index.js";
import { serverStatusModule } from "./serverStatus/index.js";
import { weeklyReportModule } from "./weeklyReport/index.js";
import { meetingModule } from "./meeting/index.js";

export const modules = [
  systemModule,
  setupModule,
  supportModule,
  verifyModule,
  reactionRoleModule,
  contentCreatorModule,
  serverStatusModule,
  weeklyReportModule,
  meetingModule
];
