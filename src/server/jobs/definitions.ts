import "server-only";
import { insightJobDefinition } from "./insight";
import { interviewEvaluationJobDefinition, interviewQuestionsJobDefinition } from "./interview";
import { registerJobType } from "./registry";

/**
 * Production job types (C-6 비동기 작업), registered once when the app runner
 * module loads. S6: AI-02 `insight`. S8: AI-05 `interview_questions`,
 * AI-06 + AI-07 `interview_evaluation`. (S7 drafts run inside their requests.)
 */
registerJobType(insightJobDefinition);
registerJobType(interviewQuestionsJobDefinition);
registerJobType(interviewEvaluationJobDefinition);
