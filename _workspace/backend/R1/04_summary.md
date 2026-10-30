# R1 기획 결정 반영 (백엔드 후속 수정) 요약

- 상태: done (2026-11-05). QA 2라운드를 마쳤고 열린 이슈는 없다.
- 기준: 사용자 확정 A1~A24(`planning-decisions-2026-11-05.md`)와 갱신된 기획 문서. 기획 문서는 브랜치 `claude/planning-backend-gaps-3192d0`에 있고 아직 커밋하지 않았다(PRD v4.3, UX v5.3, AI v4.3, DM v4.2).
- 하지 않은 것
  - A2: 요건 편집 기능(F-P2-03, Could)이 아직 없어서 하지 않았다.
  - A1: 기획 리더의 해석(같은 행 다시 시도 = 처음 공급자, 새 작업 = 활성 공급자)이 현재 구현과 같아서 바꾸지 않았다. 사용자 확인을 기다린다.

## 반영한 것
| # | 결정 | 구현 |
|---|------|------|
| A5 | 메시지 상한 40에서 시작 인사를 뺀다 | 대화 시작 시 `message_count` = 0으로 둔다. 기존 행은 인사가 있으면 1을 뺀다. 응답에 `remainingMessages`를 준다 |
| A6 | 그만둔 대화를 다시 이어 한다 | `abandoned → active` 전이를 허용하고 `last_activity_at`을 갱신한다. `resumeWritingChat`, S-08 목록(작성 중과 그만둔 대화), S-10 대화 기록 목록을 추가했다 |
| A7 | 탈퇴 미완료 계정은 동의 게이트보다 먼저 S-25로 보낸다 | `get_account_deletion_state(p_user_id, p_subject_hash)`(service_role 전용)를 추가했다 |
| | | 판정은 `profiles`가 없을 때만 한다. 미완료면 페이지·로그인 콜백·액션이 S-25로 보내거나 403을 낸다 |
| | | 동의 저장 경로도 막았다(QA-R1-02) |
| A10 | 희망 직무·관심 산업은 판단 근거가 아니다 | V-4 근거 집합에서 뺐다(인사이트·서류·면접 공통). `total_years_of_experience`는 그대로 근거다. 프롬프트 규칙을 추가했다 |
| A11 | 직무 질문의 사실 전제는 행동·결과·성과에서만 | `requirement_fit`에도 적용한다. 사실을 전제하지 않는 `gap_probe`는 예외다. 이 규칙을 어긴 질문은 버리고 다시 만든다 |
| A13 | 서류 생성 요청 안에서는 JD 추출을 하지 않는다 | 세 경로(경력기술서, 자소서 문항, 기본 선택)에서 추출을 뺐다. 요건이 없으면 409 `jd_not_extracted`, 추출 중이면 409 `extraction_in_progress`를 내고 공급자를 호출하지 않는다. 생성 예산은 58초 전부를 쓴다 |
| A18 | 이름·역할이 빠진 프로젝트는 그 폼으로 안내한다 | readiness에 `project_fields` 힌트를 추가했다(`form` + `suggested_project_id`, 완료 프로젝트가 0개일 때) |
| A19 | 키 저장·확인 RPC는 서버만 부른다 | `p_user_id` 인자를 추가하고 service_role만 실행할 수 있게 했다. 사용자 세션 경로는 없앴다 |
| A20 | 재동의 규칙을 하나로 맞춘다 | DB와 TS 모두 "`requires_reconsent`인 새 버전이 있을 때만"으로 판정한다(등록, 등급 변경, 실행) |
| A22 | 면접 질문 세트 단위 기록 | `interview_sessions.question_validation_report`, `question_usage`에 모든 생성 호출을 합산해 저장한다 |
| A23 | AI-11이 실패하면 대체 선택을 하지 않는다 | 빈 선택과 `selectionOrigin = user`를 돌려준다. 계약 필드 이름을 바꿨다(`selectionOrigin`/`failed`/`reason`) |
| A24 | AI의 근거 직접 INSERT 권한을 없앤다 | `app_ai_writer`의 `evidence_links` INSERT 정책과 권한을 회수했다 |

- 프롬프트 버전 상승: AI-02 v3, AI-03 v2, AI-04 v2, AI-05 v2, AI-06 v2. R1 이전 결과는 재사용하지 않는다(의도한 동작).
- 마이그레이션: `20261105000100`~`0700`(7개, 전진 방식)

## 검사
| 검사 | 결과 |
|------|------|
| typecheck | 통과 |
| lint | 통과 |
| Vitest | 통과 (90파일, 1414개, 통합 테스트 포함) |
| build | 통과 |
| pgTAP | 통과 (44파일, 2078개) |

## QA
- 1라운드에서 Minor 2건이 나왔고 모두 고쳤다.
  - 새 오류 코드의 매핑이 빠져 있었다.
  - 탈퇴 미완료 계정이 동의를 새로 쓸 수 있었다.
- 2라운드에서 탈퇴 미완료 계정이 탈퇴 마무리 말고는 쓸 수 있는 경로가 없음을 확인했다.

## 확인·후속
- A1 해석이 맞는지 사용자 확인이 필요하다(현재 구현 그대로 둠).
- 기획 반영 브랜치(`claude/planning-backend-gaps-3192d0`)의 커밋·병합이 필요하다. 이 브랜치의 `docs/planning/`은 아직 옛 버전이다.
- 구현이 새로 정한 것(spec-gaps "2026-11-05 · R1")
  - `get_account_deletion_state`의 `p_subject_hash` 인자(DM 6.1에 추가 필요)
  - `profile_missing` 처리 `[가정]`
  - S-25 경로 `/settings/account/delete` `[가정]`
  - 희망 정보 근거가 다른 근거와 함께 저장되는 경우
  - gap_probe 사실 전제 판정 방법 `[가정]`
- 원격 반영 시 A5 데이터 보정 전후의 `message_count` 분포를 비교한다.
