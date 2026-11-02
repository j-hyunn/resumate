/**
 * Project classification (CR-9, CR-17 확정 값 목록 — PRD F-P1-19, DM v4.4 2.3).
 * DB stores the keys; the pack shows display names (AI C-1.2). Classification
 * is the user's own label: reference only, never evidence (V-2 has no such
 * field), never stated as a fact in generated text.
 *
 * Keys must match the DB CHECK lists (db-engineer) and src/lib/contracts/enums.ts
 * (api-engineer); backend-qa compares them.
 */

export const PROJECT_TYPES = [
  "new_build",
  "improvement",
  "operation",
  "research",
  "marketing",
  "process_improvement",
  "migration",
  "coursework",
  "other",
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const EXPERIENCE_TYPES = [
  "impact",
  "problem_solving",
  "collaboration",
  "leadership",
  "failure_recovery",
  "new_challenge",
  "customer_facing",
] as const;
export type ExperienceType = (typeof EXPERIENCE_TYPES)[number];

export const COMPETENCIES = [
  "problem_solving",
  "analysis",
  "planning",
  "execution",
  "communication",
  "collaboration",
  "leadership",
  "technical_expertise",
  "customer_insight",
  "learning_agility",
] as const;
export type Competency = (typeof COMPETENCIES)[number];

/** CR-17: at most 3 competencies, no duplicates, selection order kept. */
export const MAX_COMPETENCIES = 3;

export const CLASSIFICATION_FIELDS = ["project_type", "experience_type", "competencies"] as const;
export type ClassificationField = (typeof CLASSIFICATION_FIELDS)[number];

export const PROJECT_TYPE_LABELS: Readonly<Record<ProjectType, string>> = {
  new_build: "신규 구축",
  improvement: "개선·고도화",
  operation: "운영·유지보수",
  research: "분석·리서치",
  marketing: "마케팅·캠페인",
  process_improvement: "프로세스·조직 개선",
  migration: "전환·마이그레이션",
  coursework: "교육·학습 과제",
  other: "기타",
};

export const EXPERIENCE_TYPE_LABELS: Readonly<Record<ExperienceType, string>> = {
  impact: "성과 창출",
  problem_solving: "문제 해결",
  collaboration: "협업·갈등 조정",
  leadership: "주도·리딩",
  failure_recovery: "실패·극복",
  new_challenge: "새로운 시도",
  customer_facing: "고객·사용자 대응",
};

export const COMPETENCY_LABELS: Readonly<Record<Competency, string>> = {
  problem_solving: "문제 해결력",
  analysis: "분석력",
  planning: "기획력",
  execution: "실행력",
  communication: "커뮤니케이션",
  collaboration: "협업",
  leadership: "리더십",
  technical_expertise: "기술 전문성",
  customer_insight: "고객 이해",
  learning_agility: "학습 민첩성",
};

/**
 * One-line definitions for the AI-12 extract system block (AI-12 프롬프트 전략
 * "세 분류의 키·표시명·한 줄 정의"). Wording is ours [가정]; changing it bumps
 * the AI-12 extract prompt version.
 */
export const PROJECT_TYPE_DEFINITIONS: Readonly<Record<ProjectType, string>> = {
  new_build: "없던 서비스·시스템·제품을 새로 만듦",
  improvement: "이미 있는 것의 기능·성능·품질을 높임",
  operation: "기존 서비스·시스템을 안정적으로 운영하고 유지함",
  research: "데이터·시장·사용자를 분석하거나 조사함",
  marketing: "홍보·캠페인·마케팅 활동을 기획하고 실행함",
  process_improvement: "일하는 방식·절차·조직 운영을 바꿈",
  migration: "기존 시스템·도구·환경을 다른 것으로 옮기거나 바꿈",
  coursework: "수업·교육 과정의 과제나 학습 프로젝트",
  other: "위 어디에도 맞지 않음",
};

export const EXPERIENCE_TYPE_DEFINITIONS: Readonly<Record<ExperienceType, string>> = {
  impact: "눈에 띄는 결과·성과를 만든 경험",
  problem_solving: "문제의 원인을 찾아 해결한 경험",
  collaboration: "여러 사람과 협력하거나 의견 차이를 조율한 경험",
  leadership: "일을 주도하거나 사람을 이끈 경험",
  failure_recovery: "실패·어려움을 겪고 극복한 경험",
  new_challenge: "처음 해 보는 일에 도전한 경험",
  customer_facing: "고객·사용자를 직접 대응한 경험",
};

export const COMPETENCY_DEFINITIONS: Readonly<Record<Competency, string>> = {
  problem_solving: "문제를 정의하고 해결책을 찾는 힘",
  analysis: "데이터·상황을 나누어 원인과 의미를 찾는 힘",
  planning: "목표를 세우고 방법·순서를 설계하는 힘",
  execution: "계획을 끝까지 실행해 결과를 내는 힘",
  communication: "생각을 분명히 전하고 듣는 힘",
  collaboration: "다른 사람과 함께 일을 맞춰 가는 힘",
  leadership: "방향을 제시하고 사람을 움직이는 힘",
  technical_expertise: "전문 기술·도구를 깊이 다루는 힘",
  customer_insight: "고객·사용자의 필요를 이해하는 힘",
  learning_agility: "새로운 것을 빠르게 배우고 적용하는 힘",
};

export function isProjectType(v: unknown): v is ProjectType {
  return typeof v === "string" && (PROJECT_TYPES as readonly string[]).includes(v);
}
export function isExperienceType(v: unknown): v is ExperienceType {
  return typeof v === "string" && (EXPERIENCE_TYPES as readonly string[]).includes(v);
}
export function isCompetency(v: unknown): v is Competency {
  return typeof v === "string" && (COMPETENCIES as readonly string[]).includes(v);
}

/** Display line for the pack's `<classification>` tag; null when nothing is chosen. Unknown keys are skipped. */
export function classificationLine(p: { project_type: string | null; experience_type: string | null; competencies: readonly string[] }): string | null {
  const parts: string[] = [];
  if (isProjectType(p.project_type)) parts.push(`프로젝트 종류: ${PROJECT_TYPE_LABELS[p.project_type]}`);
  if (isExperienceType(p.experience_type)) parts.push(`경험 유형: ${EXPERIENCE_TYPE_LABELS[p.experience_type]}`);
  const comps = p.competencies.filter(isCompetency).map((c) => COMPETENCY_LABELS[c]);
  if (comps.length) parts.push(`역량: ${comps.join(", ")}`);
  return parts.length ? parts.join(" / ") : null;
}
