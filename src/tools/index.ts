import type { AgentTool } from "@earendil-works/pi-agent-core";

import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createFindTool } from "./find.js";
import { createGrepTool } from "./grep.js";
import { createLsTool } from "./ls.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export function createBuiltinTools(projectRoot: string): AgentTool[] {
  return [
    createReadTool(projectRoot),
    createWriteTool(projectRoot),
    createEditTool(projectRoot),
    createBashTool(projectRoot),
    createGrepTool(projectRoot),
    createFindTool(projectRoot),
    createLsTool(projectRoot),
  ];
}
