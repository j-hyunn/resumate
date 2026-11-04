import type { SensitiveCategory } from "../../schemas/AI-12";

/**
 * C-7 민감정보 판정 regression set (R8: 진단 probes + R8 QA round 1,
 * `_workspace/backend/R8/03_backend-qa_report.md` QA-02 / QA-03 / 점검 4).
 * Synthetic sentences only. Work sentences must stay clean; personal ones are flagged.
 */

/** Work / domain sentences: 0 false positives. */
export const WORK_SENTENCES: readonly string[] = [
  // R8 진단 (R4 word patterns flagged these)
  "병원 예약 시스템을 개발했어요",
  "입원 환자 조회 화면을 만들었어요",
  "수술 일정 관리 기능을 맡았어요",
  "출산 휴가 신청 기능을 개발했어요",
  "병가 처리 HR 기능을 만들었어요",
  "교회 출석 앱 외주를 했어요",
  "파업 대응 공지 시스템을 만들었어요",
  "선거 결과 시각화 대시보드를 만들었어요",
  "기획자 선배가 코드 리뷰를 해 줬어요",
  "사업부 부장님께 보고했어요",
  "제가 병원 예약 시스템의 결제 모듈을 맡았어요",
  "저는 환자가 입원했을 때 보호자에게 알림을 보내는 기능을 만들었어요",
  "고객사 팀장님과 일정을 조율했어요",
  // QA-02: disease / domain nouns followed by a work noun
  "암 진단 AI 모델을 개발함",
  "저는 암 진단 모델 서빙을 맡았음",
  "당뇨 치료 앱의 혈당 기록 기능을 개발함",
  "항암 치료 일정 관리 화면을 만듦",
  "ADHD 증상 자가진단 앱을 만듦",
  "번아웃 증상을 줄이는 사내 캠페인을 기획함",
  "우울증 치료 콘텐츠 추천 알고리즘을 설계함",
  "정신과 진료 예약 플랫폼을 개발함",
  "심리 상담을 받을 수 있는 챗봇을 만듦",
  // QA-02: subject-less modifiers (adnominal / "중" + noun)
  "수술을 받는 날짜를 예약하는 기능을 만듦",
  "입원하고 퇴원하는 흐름을 자동화함",
  "임신 중 주의사항 콘텐츠를 제작함",
  "치료받을 수 있는 병원 검색 기능을 만듦",
  "휴직 중 급여 계산 로직을 구현함",
  "출산했을 때 받을 수 있는 지원금 안내 페이지를 만듦",
  "몸이 안 좋은 날 쓰는 재택 신청 기능을 만듦",
  "노조에 가입한 인원 통계를 집계함",
  "정당을 지지하는 비율을 시각화함",
  // QA 점검 4 (already clean, kept)
  "보안 진단을 받았음",
  "외부 감사에서 진단을 받아 개선함",
  "서비스 장애로 치료가 필요한 데이터를 복구함",
  "고객이 병원에 입원했을 때 알림을 보냄",
  "육아휴직 신청 기능을 만듦",
  "교회 출석 관리 앱을 만듦",
  "파업 공지 배너를 띄움",
  "마케팅 팀장님과 협업함",
  "연구원 분들과 실험함",
  // extra
  "외부 업체에게 보안 진단을 받았어요",
  "디스크 때문에 서버가 멈췄어요",
  "직원이 병가를 냈을 때 대체 인력을 배정하는 기능을 만들었어요",
  "제가 육아휴직 신청 화면을 개발했어요",
  "병가 사용 내역 조회 기능을 만듦",
  "신자 수 통계를 집계함",
  "제가 조합원 관리 시스템을 만들었어요",
  "지지 정당 얘기가 나왔어요",
  "연구소 실장님이 승인했어요",
  "제가 맡았어요. 신앙 공동체 앱이었어요.",
  // R8 QA round 2 (QA-08, leader fix)
  "신사업 프로젝트를 이끎",
  "사이드 프로젝트를 만듦",
  "휴가 쓰는 규칙을 정리함",
];

/** The user's / family's own circumstances, contact details, names with a title. */
export const PERSONAL_SENTENCES: readonly (readonly [string, readonly SensitiveCategory[]])[] = [
  // QA-03 (-음 체 values the R8 first cut missed)
  ["입원함", ["health"]],
  ["병가를 냄", ["health"]],
  ["출산함", ["health"]],
  ["임신함", ["health"]],
  ["육아휴직을 함", ["health"]],
  ["출산 휴가를 씀", ["health"]],
  ["가족 간병으로 휴직함", ["health"]],
  ["아버지 간병 때문에 휴직함", ["health"]],
  ["번아웃으로 퇴사함", ["health"]],
  ["노조 활동을 함", ["union"]],
  ["선거 운동을 함", ["politics"]],
  ["교회에 다님", ["religion"]],
  ["제가 조합원임", ["union"]],
  ["저는 천주교 신자임", ["religion"]],
  // already caught, kept
  ["우울증 진단을 받아 휴직함", ["health"]],
  ["제가 우울증 진단을 받아 휴직함", ["health"]],
  ["수술을 받아 3개월 쉬었음", ["health"]],
  ["건강 문제로 퇴사함", ["health"]],
  ["개인적으로 우울증 치료를 받음", ["health"]],
  ["제가 우울증 진단을 받아서 휴직했어요", ["health"]],
  ["우울증 치료를 받느라 쉬었어요", ["health"]],
  ["병가를 냈어요", ["health"]],
  ["아내가 출산해서 육아휴직을 썼어요", ["health"]],
  ["주말엔 교회에 가요", ["religion"]],
  ["제 신앙이 깊어요.", ["religion"]],
  ["저는 노조 활동을 했어요", ["union"]],
  ["노조 활동을 했어요", ["union"]],
  ["제 지지 정당은 말하기 어려워요", ["politics"]],
  ["선거 운동을 도왔어요", ["politics"]],
  ["연락처는 010-1234-5678이에요", ["contact"]],
  ["메일 test.user@example.com", ["contact"]],
  ["김민수 팀장님과 했어요", ["third_party_name"]],
  ["김민수 팀장님과 진행함", ["third_party_name"]],
  ["박지연님과 협업했어요", ["third_party_name"]],
  ["남궁민 대리가 도와줬어요", ["third_party_name"]],
  // R8 QA round 2 (QA-07, leader fix: 쓰다 forms)
  ["제가 육아휴직을 씀", ["health"]],
  ["아내 출산으로 육아휴직을 씀", ["health"]],
  ["병가를 썼어요", ["health"]],
];
