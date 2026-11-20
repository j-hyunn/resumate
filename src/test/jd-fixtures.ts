/**
 * Synthetic JD raw texts for integration tests (fictional companies; no real postings).
 * R17: moved out of the deleted AI-01 fixtures — the JD is used as raw text only.
 */

/** Korean backend JD. S1 title, S2 intro, S3 header, S4–S5 duties, S6 header, S7–S9 required, S10 header, S11–S12 preferred, S13 benefits. */
export const KO_BACKEND = {
  raw: [
    "에이비씨페이 백엔드 엔지니어 (결제)",
    "에이비씨페이는 간편결제 서비스를 만드는 가상의 회사입니다.",
    "[주요 업무]",
    "- 결제 승인·정산 API 설계 및 운영",
    "- 대용량 트래픽 처리를 위한 성능 개선",
    "[자격 요건]",
    "- Java/Kotlin 기반 Spring 서버 개발 경험",
    "- 백엔드 개발 경력 5년 이상",
    "- RDBMS 설계 경험",
    "[우대 사항]",
    "- Kafka 등 메시지 큐 운영 경험",
    "- 결제 도메인 경험",
    "복지: 자율 출퇴근, 도서 구입비 지원",
  ].join("\n"),
};
