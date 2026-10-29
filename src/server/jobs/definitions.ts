import "server-only";
import { insightJobDefinition } from "./insight";
import { registerJobType } from "./registry";

/**
 * Production job types (C-6 비동기 작업), registered once when the app runner
 * module loads. S6: AI-02 `insight`. S7/S8 add theirs here.
 */
registerJobType(insightJobDefinition);
