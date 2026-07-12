import { setupModule } from "./setup/index.js";
import { supportModule } from "./support/index.js";
import { verifyModule } from "./verify/index.js";
import { systemModule } from "./system/index.js";
import { updatesModule } from "./updates/index.js";

export const modules = [
  systemModule,
  setupModule,
  supportModule,
  verifyModule,
  updatesModule
];
