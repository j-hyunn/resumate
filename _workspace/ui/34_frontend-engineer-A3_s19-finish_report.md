# 34 S-19 초안 편집기 마무리 — 재연결 · done.draftId · A3 UQ-84 (c)~(g)

- 날짜: 2026-11-04 · 범위: S-19 (`/applications/[id]/drafts/[draftId]`)만
- 기준: 02 C-04 "이탈 시 서버가 끝까지 생성·저장", 03 C-6 동일 입력 재사용, 03 AI-03 "다시 생성이 아니고 같은 `input_hash`의 `ready` 초안이 있으면 호출 없이 그 초안을 보여 준다", 02 S-19 자소서 문항별 목록("원본 삭제 시 `source_label`")

## 1. 새로고침 후 재연결

SSE 스트림은 처음 요청에 묶여 있어 다시 붙을 수 없다. 블록도 `validated` 전에는 서버에만 있다. 그래서 진행 중인 `ai_jobs` 행을 따라간다.

| 대상 | 판단 | 화면 |
|------|------|------|
| 경력기술서 | `drafts.status = 'generating'` + `ai_job_id` 있음 + 이 화면이 스트리밍 중이 아님 | 본문 자리에 C-04 대기: "작성 중…" + 중단 + "화면을 떠나 있는 동안에도 계속 만들고 있어요. 끝나면 결과를 바로 보여 드려요" `[UI-가정]` + PendingBlock |
| 경력기술서 임시 행(W3-2 쿠키, 행이 아직 없음) | `realGetDraft`가 그 id를 대상으로 하는 `queued`/`running` `career_description` 작업을 찾아 `ai_job_id`로 넣는다 | 위와 같음. 작업이 없으면(스트림이 시작되지 않음) 기존처럼 "초안 생성" |
| 자소서 문항 | `draft_sections.status = 'generating'` + `ai_job_id` | 그 문항 카드에 같은 대기. 문항 버튼은 숨김 |

- 폴링: `useAiJob`(기존 훅, `getAiJob`이 멈춘 작업도 실패로 닫음). 끝나면 `router.refresh()` → 저장된 결과·C-20(실패 원인은 `storedFailure`, 새로고침 뒤에도 반영되게 동기화 추가).
- 재연결 중 "중단": 스트림 중단과 같은 `finalize*Action(…, { canceled: true })` → 서버 `stopRun`. 경력기술서는 Q53-7 그대로(다시 생성 → 원래 초안, 첫 생성 → S-17 `#new-draft`).
- 다른 곳(다른 탭)에서 중단된 다시 생성: 행이 없어지므로 원래 초안으로 이동.
- 재연결 중에는 다른 생성·다시 생성 버튼이 막힌다(`guard.busy`).
- `[UI-가정]` "전체 생성"의 남은 문항 대기열은 화면 메모리라 새로고침하면 이어지지 않는다. 진행 중이던 문항만 따라간다.
- 판단 함수 `remote-runs.ts` + 시험.

## 2. `done.draftId`

- 서버: `prepareCareerDescription`이 `draftId`(S-17에서 연 임시 행 id)가 있어도 "다시 생성"(`regeneratedFromId`)이 아니면 C-6 재사용을 본다. 전에는 `draftId`가 있으면 재사용을 건너뛰어, 화면에서 시작한 생성은 재사용이 한 번도 일어나지 않았다(UQ-84 (a)의 input_hash 재사용 부분).
- 클라이언트: `realBlockStream`이 `done { draftId, reused }`를 `{ type: "done", draft_id, reused }`로 넘기고 `useAiStream().doneInfo`로 노출. 편집기는 성공 후 `draft_id`가 지금 초안과 다르면 finalize(쿠키 정리) 뒤 그 초안으로 `router.replace` + "같은 설정으로 만든 초안이 있어 그 초안을 열었어요" `[UI-가정]`.
- 같은 id(보통 생성)는 이전처럼 새로고침만.

## 3. A3 UQ-84 (c)~(g)

| 항목 | 결과 | 근거 |
|------|------|------|
| (c) `usage_events.ai_job_id`에 초안·섹션 ID | 해당 없음(실제 백엔드 해결) | 사용량 기록은 `src/server/jobs/usage-recorder.ts`가 `aiJobId: job.id`로 쓴다. 섹션·초안 ID를 넣던 것은 목 shim뿐이고, 목은 이제 `?state=` 미리보기 전용 |
| (d) 사용자가 고른 근거의 `rationale = null` | 해당 없음(실제 백엔드 해결) | AI-04 `validateSources` user 모드: "the model only supplies rationale / requirement refs / evidence for matching entries"(`src/server/ai/pipelines/AI-04.ts`), 저장 시 `rationale: s.view.rationale` |
| (e) C-11 경로 라벨을 항상 `source_label` 스냅샷으로 | **수정** | `sourceRowLabel`(`src/components/applications/source-label.ts`): 원본이 살아 있고 출처 트리에 있으면 `tree.project_labels`(지금 이름), 원본 삭제·트리에 없음(작성 중 등)이면 저장 라벨. 시험 추가 |
| (f) 완료·실패 확정을 클라이언트가, 이탈은 20초 규칙 | 해당 없음(실제 백엔드 해결) | SSE 라우트가 성공·실패를 서버에서 저장하고(`runCareerDescription`·`runCoverLetterSection`), 클라이언트 finalize는 중단만 처리한다(`realFinalize*`). `settleAbandonedGeneration`은 실제 경로에서 아무것도 하지 않는다(목 전용) |
| (g) AI-11을 S-17 진입마다 호출 | 해당 없음(실제 백엔드 해결) | `realRankDraftSources` → `rankDraftSourcesForProject(…, { refresh: false })`가 같은 `input_hash`(공급자·모델·career_snapshot_hash·requirements_hash)의 성공 결과를 재사용하고, 인사이트 우선순위가 있으면 호출하지 않는다 |

## 검사

- `pnpm typecheck`, `pnpm lint`, `pnpm test`(131 파일 2,249 시험) 통과, `pnpm build` 통과
- 로컬 스택 통합 시험 `drafts.integration.test.ts`, `w3.integration.test.ts` 통과(16)
- 새 시험: `remote-runs.test.ts`, `source-label.test.ts`, `ai-stream-client.test.ts`(done.draftId), `drafts.test.ts`(임시 id로도 재사용)

## 하지 않은 것

- **실제 공급자 스트림 끝까지**: 하지 않음(이 세션에 테스트 키 없음).
- **브라우저 확인**: 하지 않음. 로컬 로그인이 Google 전용이라 테스트 계정으로 들어갈 수 없다. 재연결(생성 중 새로고침), 재사용 이동, 중단은 브라우저로 확인해야 한다.
- ui-qa 검토 미실시.

## 남은 것(후속)

- 출처 트리 `project_labels`는 소속 이름이 비면 " › 프로젝트명"이 된다(저장 라벨 규칙은 부모를 뺀다). 기존 동작, 교육 이름 작업과 같은 파일이라 손대지 않음.
- AI-04 문항 첫 생성의 동일 입력 재사용은 이번 범위 밖(문항 생성은 매번 새로 호출).
