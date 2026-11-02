/** Mock AI output meta (04 §0 AI 출력 공통 메타) for fixtures and fake AI results. */
import type { AiOutputMeta, AiProviderName, ConnectionTier, ModelTier } from "@/types/db"
import { MOCK_MODELS } from "./ai-providers"

export interface MockRunner {
  provider: AiProviderName
  connection_tier: ConnectionTier
  model_tier?: ModelTier
}

/** Fixture default: Gemini 무료 키 (05 brief) */
export const DEFAULT_RUNNER: MockRunner = { provider: "gemini", connection_tier: "free", model_tier: "default" }

export function mockAiMeta(jobId: string | null, runner: MockRunner = DEFAULT_RUNNER): AiOutputMeta {
  const tier = runner.model_tier ?? "default"
  return {
    ai_job_id: jobId,
    schema_version: 1,
    prompt_version: "mock.v1",
    provider: runner.provider,
    model: MOCK_MODELS[runner.provider][tier],
    model_tier: tier,
    connection_tier: runner.connection_tier,
    input_hash: null,
    career_snapshot_hash: null,
    validation_report: null,
    usage: null,
  }
}

/** writing_chat_messages meta: assistant rows carry the runner, user rows / greeting null */
export function mockMessageMeta(runner: MockRunner | null) {
  if (!runner) return { provider: null, model: null, model_tier: null, connection_tier: null }
  const tier = runner.model_tier ?? "default"
  return { provider: runner.provider, model: MOCK_MODELS[runner.provider][tier], model_tier: tier, connection_tier: runner.connection_tier }
}
