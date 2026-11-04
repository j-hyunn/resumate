/**
 * Consent item definitions and policy document types (client-safe constants).
 * Moved from components/account/policy-content.ts (A1 UQ-95) so lib/data/account.ts does not
 * depend on area components. Policy *versions* are rows in the mock store (policy_versions),
 * read on the server via getPolicyVersions() and passed to client components as props.
 */
import type { ConsentType, PolicyType } from "@/types/db"

export interface ConsentItem {
  consent_type: ConsentType
  label: string
  required: boolean
  /** which policy document the "보기" link opens (S-30 page /policies/{policy_type}) */
  policy_type: PolicyType
  description?: string
}

/**
 * Sign-up (S-03) and S-24 service consents. [UI-가정] required / optional split per item.
 * v5 (F-COM-02 v4, S-03): the AI-provider cross-border / data-use consent is NOT taken at sign-up —
 * it moved to key connection (C-21, ai_data_use_consents). `cross_border_transfer` stays in the
 * ConsentType enum and policy types for existing rows and the S-30 notice, but is not listed here.
 */
export const CONSENT_ITEMS: ReadonlyArray<ConsentItem> = [
  { consent_type: "terms", label: "이용약관 동의", required: true, policy_type: "terms" },
  { consent_type: "privacy_required", label: "개인정보 수집·이용 동의", required: true, policy_type: "privacy" },
  {
    consent_type: "service_improvement",
    label: "서비스 개선을 위한 이용 기록 활용",
    required: false,
    policy_type: "privacy",
    // [UI-가정] description copy
    description: "어떤 기능을 얼마나 쓰는지 같은 이용 기록만 써요. 입력한 커리어·대화 내용은 쓰지 않아요",
  },
  {
    consent_type: "marketing",
    label: "새 기능·이벤트 소식 받기",
    required: false,
    policy_type: "privacy",
    description: "이메일로 받아요. 언제든 설정에서 끌 수 있어요",
  },
]

export const REQUIRED_CONSENT_TYPES = CONSENT_ITEMS.filter((c) => c.required).map((c) => c.consent_type)

export const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  terms: "이용약관",
  privacy: "개인정보 처리방침",
  cross_border_transfer: "국외 이전 고지",
}

export const POLICY_TYPES: ReadonlyArray<PolicyType> = ["terms", "privacy", "cross_border_transfer"]

export function isPolicyType(value: unknown): value is PolicyType {
  return typeof value === "string" && (POLICY_TYPES as readonly string[]).includes(value)
}

