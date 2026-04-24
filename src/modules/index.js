import { setupModule } from "./setup/index.js";
import { verifyModule } from "./verify/index.js";
import { systemModule } from "./system/index.js";

export const modules = [
  systemModule,
  setupModule,
  verifyModule
];
