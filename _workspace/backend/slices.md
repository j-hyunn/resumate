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
| S5 application projects & JD | done | 2026-10-31 | 연결 대기 (A3, A4) | 없음 (QA-S5-06은 S6에서 해결) · 사용자 확인 [가정] 8건 |
| S6 insights | done | 2026-11-01 | 연결 대기 (A3) | 없음 · 사용자 확인 [가정] 8건, 기획 확인 2건 |
| S7 documents | done | 2026-11-02 | 연결 대기 (A3) | 없음 (QA-S7-10은 S8에서 해결) · 사용자 확인 [가정] 8건, 기획 확인 3건 |
| S8 mock interview | done | 2026-11-03 | 연결 대기 (A4) | 없음 · 사용자 확인 [가정] 8건, 기획 확인 4건 |
| S9 account & retention | done | 2026-11-04 | 연결 대기 (A1 설정·탈퇴) | Minor 1 (QA-S9-07 테스트 보강) · 사용자 확인 [가정] 5건, 기획 확인 4건 |
| R1 planning decisions (A5~A24) | done | 2026-11-05 | 연결 대기 | 없음 · A1 해석 사용자 확인 대기, 기획 브랜치 병합 필요 |

## 2026-10-28 BYOK 기획 개정 (v4) 영향
기획이 BYOK로 바뀌어 S3 재작업과 새 슬라이스(S3a AI 실행 기반 v4, S3b BYOK 키·동의)가 필요하다. 계획: `byok/01_rework-plan.md`. S0~S2는 소규모 수정만 필요하고 `done`을 유지한다. S3는 `rework`.
