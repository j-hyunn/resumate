/**
 * A1 account copy and policy data shared by S-03 (동의), S-24 (설정), S-30 (처리방침·약관).
 * Client-safe (no server imports).
 *
 * Sources: 01-prd.md F-COM-02/03, NFR-PRV-03~06, D-10, D-11, D-27 / 04-data-model.md A.2, 4.4.
 * The legal body text is not in the planning documents ("v3와 같음", v3 not in repo), so the
 * policy documents below are structural drafts built only from settled facts.
 */
import type { PolicyType } from "@/types/db"

// ---------------------------------------------------------------------------
// Consent items (consents.consent_type)
// ---------------------------------------------------------------------------

// Moved to lib (A1 UQ-95); re-exported so existing imports keep working.
export {
  CONSENT_ITEMS,
  REQUIRED_CONSENT_TYPES,
  POLICY_TYPES,
  POLICY_TYPE_LABELS,
  isPolicyType,
  type ConsentItem,
} from "@/lib/data/consent-items"

/** NFR-PRV-03 (D-10, v3 adds AI 작성 대화 내용): data sent to the LLM API provider abroad */
export const CROSS_BORDER_ITEMS = [
  "커리어 데이터(경력·교육·프로젝트·상세 내용·정량 성과·스킬)",
  "AI 작성 대화 내용",
  "공고 원문(JD)",
  "자기소개서 메모",
  "면접 답변",
] as const

/** F-COM-03 v4 / NFR-PRV-04 — single source in lib/data/labels (UQ-209). Call sites append "." */
export { AI_TRAINING_NOTICE } from "@/lib/data/labels"
import { AI_TRAINING_NOTICE } from "@/lib/data/labels"

/** NFR-PRV-05 */
export const SENSITIVE_INFO_NOTICE =
  "자유 서술란과 AI 작성 대화에는 민감정보(건강·종교 등), 다른 사람의 개인정보, 회사 기밀을 쓰지 말아 주세요"

// ---------------------------------------------------------------------------
// S-30 policy documents
// ---------------------------------------------------------------------------

export interface PolicySection {
  heading: string
  paragraphs?: string[]
  items?: string[]
}

// [UI-가정] Section structure and wording. Only facts settled in the PRD / data model are
// stated; the final legal text replaces this (기획 확인 필요 S-30).
export const POLICY_DOCUMENTS: Record<PolicyType, PolicySection[]> = {
  terms: [
    {
      heading: "서비스 내용",
      paragraphs: [
        "Resumate는 사용자가 입력한 커리어 데이터를 바탕으로 기업 JD별 인사이트, 경력기술서·자기소개서 초안, 모의 면접을 제공하고 지원 현황을 관리하는 서비스예요.",
      ],
    },
    {
      heading: "AI 결과물",
      paragraphs: [
        "AI가 만든 인사이트·초안·평가는 참고용이에요. 사용자가 입력하지 않은 경험은 만들지 않도록 설계했지만, 제출 전에는 반드시 직접 확인해 주세요.",
        "모의 면접 점수는 연습용 참고 지표이며 실제 채용 결과를 예측하지 않아요.",
      ],
    },
    {
      // v4 BYOK (D-34): 서비스 월 한도 없음. [UI-가정] 약관 문구는 법무 확정 전 임시
      heading: "AI 연결과 비용",
      paragraphs: [
        "AI 기능은 사용자가 연결한 AI 공급자 키로 실행돼요. 사용량과 비용은 공급자 계정에 청구되고, Resumate는 별도 한도나 요금을 두지 않아요.",
      ],
    },
    {
      heading: "계정 해지",
      paragraphs: ["설정 > 회원 탈퇴에서 언제든 탈퇴할 수 있고, 탈퇴하면 모든 데이터가 즉시 삭제돼요."],
    },
  ],
  privacy: [
    {
      heading: "수집하는 정보",
      items: [
        "계정: 이메일(로그인용)",
        "커리어: 경력·교육(기관·과정·기간까지, 학점·성적은 받지 않음)·프로젝트·상세 내용·정량 성과·스킬",
        "기업 JD: 공고 원문, 인사이트, 서류 초안, 모의 면접 질문·답변·평가, 전형 단계 이력",
        "AI 작성 대화 기록",
        "동의 이력(서비스 동의, AI 연결 동의)",
        "AI 연결: 등록한 API 키(암호화 저장, 화면에는 마지막 4자리만), 토큰 사용 기록(토큰 수·예상 비용, 내용 없음)",
      ],
      paragraphs: ["이력서의 인적사항(주소·연락처·사진 등)은 받지 않아요."],
    },
    {
      heading: "이용 목적",
      items: ["커리어 정리와 AI 기능 제공", "선택 동의한 경우에만: 서비스 개선, 소식 안내"],
      paragraphs: [AI_TRAINING_NOTICE + "."],
    },
    {
      heading: "보유 기간과 파기",
      items: [
        "커리어, 기업 JD와 그 결과, 전형 이력, 동의 이력: 탈퇴하거나 직접 삭제할 때까지",
        "프로젝트에 저장된 AI 작성 대화: 프로젝트나 대화를 삭제하거나 탈퇴할 때까지",
        "프로젝트와 연결되지 않은 AI 작성 대화: 마지막 활동 후 90일",
        // PRD NFR-PRV-06 v4.1 / NFR-KEY-06 (UQ-90 해소: 사용 기록 13개월, 탈퇴 시 즉시 삭제 [가정])
        "API 키: 직접 삭제하거나 탈퇴하면 즉시 파기",
        "AI 작업 기록 90일, AI 토큰 사용 기록 13개월(탈퇴하면 즉시 삭제)",
        "1년 동안 접속하지 않으면 안내 후 파기",
        "탈퇴 처리 기록은 개인을 알아볼 수 없는 형태로 3년",
        "백업에 남은 데이터는 30일 안에 삭제",
      ],
    },
    {
      heading: "이용자의 권리",
      paragraphs: [
        "커리어 항목, 초안, 면접 세션, AI 작성 대화는 언제든 개별로 삭제할 수 있어요. 선택 동의는 설정에서 철회할 수 있어요.",
      ],
    },
    {
      heading: "민감정보",
      paragraphs: [SENSITIVE_INFO_NOTICE + "."],
    },
  ],
  // v5 (F-COM-02 v4, F-AI-04, D-39): 국외 이전 동의는 가입 때가 아니라 AI 키를 연결할 때 공급자·등급별로 받는다(C-21).
  cross_border_transfer: [
    {
      heading: "언제 이전되나요",
      paragraphs: [
        "AI 기능은 선택이에요. 본인 AI 키를 연결하고 AI 기능을 실행할 때만 아래 내용이 연결한 공급자에게 전송돼요. 키를 연결하지 않으면 전송되지 않아요.",
      ],
    },
    {
      heading: "이전하는 항목",
      items: [...CROSS_BORDER_ITEMS],
      paragraphs: ["AI 기능을 실행할 때 필요한 범위만 전송해요. 이메일과 표시 이름은 보내지 않아요."],
    },
    {
      heading: "이전받는 자",
      // [UI-가정] provider names only; country / retention per provider·tier are shown in C-21 (D-10: 출시 전 확정)
      paragraphs: [
        "연결한 AI 공급자(Google Gemini, Anthropic Claude, OpenAI 중 활성 공급자 1곳, 국외). 공급자별 처리 국가·학습 사용·보관 기간은 키를 연결할 때 보여 드리고 동의를 받아요.",
      ],
    },
    {
      heading: "AI 학습",
      paragraphs: [AI_TRAINING_NOTICE + "."],
    },
    {
      heading: "거부할 권리",
      paragraphs: [
        "AI 공급자로의 전송에 동의하지 않아도 가입하고 커리어·기업 JD·지원 현황 보드를 쓸 수 있어요. 키를 삭제하면 그 공급자에 대한 동의도 철회돼요.",
      ],
    },
  ],
}
