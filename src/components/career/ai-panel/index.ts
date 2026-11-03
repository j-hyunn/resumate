/**
 * Resumate AI 패널 core (S-10 · S-44). Area cards (StarProposalCard / DraftProposalCard) plug into
 * `<AiPanel renderProposal>` and read / act through the `AiPanelController` they get.
 */
export { AiPanel, type AiPanelProps } from "./ai-panel"
export { useAiPanel, type AiPanelController, type AiPanelOptions, type AiPanelTarget, type PanelBlock, type SendOptions, type TurnFailure, type TurnPhase } from "./use-ai-panel"
