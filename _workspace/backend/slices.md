# 백엔드 슬라이스 상태

| 슬라이스 | 상태 | 날짜 | 연결(UI) | 열린 이슈 |
|----------|------|------|----------|-----------|
| S0 bootstrap | done | 2026-10-24 | — | 없음 (pgTAP 해당 없음) |
| S1 foundation | done | 2026-10-24 | 연결 대기 (A1) | 없음 |
| S2 career data | done | 2026-10-25 | 연결 대기 (A2) | 없음 |
| S3 AI infrastructure | superseded → S3a/S3b | 2026-10-26 | — | Minor 2 (QA-S3-10, 12 → S4) |
| S3a AI execution (BYOK) | done | 2026-10-28 | — | 없음 (QA-S3a-11은 S3b에서 해결) |
| S3b BYOK keys & consent | done | 2026-10-29 | 연결 대기 (AI 연결 설정·미터·잠금 상태) | 설계 차이 1 (QA-S3b-06, 기획 판단) |
| S4 AI writing chat | done | 2026-10-30 | 연결 대기 (A2: S-36, S-08) | 없음 (사용자 확인 [가정] 6건) |
| S5 application projects & JD | todo | | | |
| S6 insights | todo | | | |
| S7 documents | todo | | | |
| S8 mock interview | todo | | | |
| S9 account & retention | todo | | | |

## 2026-10-28 BYOK 기획 개정 (v4) 영향
기획이 BYOK로 바뀌어 S3 재작업과 새 슬라이스(S3a AI 실행 기반 v4, S3b BYOK 키·동의)가 필요하다. 계획: `byok/01_rework-plan.md`. S0~S2는 소규모 수정만 필요하고 `done`을 유지한다. S3는 `rework`.
