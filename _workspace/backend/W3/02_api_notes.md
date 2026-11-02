# W3 API 구현 노트 (기업 JD·인사이트·서류, A3 / S5·S6·S7)

커밋, 배포, 원격 Supabase, 실제 공급자 호출 없음. `supabase db reset`도 하지 않았다. 시험 계정은 생성해 쓰고 지웠다(남은 `w3-*` 계정 0개 확인).

## 먼저 볼 것: S-19 생성은 아직 화면에서 돌지 않는다
`draft-editor.tsx`가 `stream.start({ blocks })`만 부른다. 실제 SSE로 가려면 `endpoint`를 넘겨야 하는데, 이번 지시는 `src/components/` 수정 금지다. 그래서 **서버 쪽은 끝냈고 화면 패치는 적용하지 않았다.**

- 패치: `_workspace/backend/W3/ui-request-s19.patch` (파일 4개, 약 20줄). `patch --dry-run -p1` 통과.
- 패치 전 동작: 실제 경로의 `prepareCareerDescription`·`prepareCoverLetterSection`이 null → 기존 `refusal()` 토스트. 가짜 초안은 만들지 않는다.
- 패치는 형식 검사를 깨끗하게 통과시키지 못했다. 임시 위치의 tsc는 React 타입을 찾지 못해 잡음이 많았고, 생성 분기 줄에 고유한 오류는 없었다는 정도만 확인했다. 적용 후 `pnpm typecheck`가 필요하다.

## 연결한 함수
새 파일: `lib/data/applications-real.ts`, `drafts-real.ts`, `evidence-real.ts`. 원래 파일은 `previewOr(mock, real)` 포장만 더했고 mock 본문은 `mock*`로 그대로 남겼다.

| 파일 | 함수 | 경유 |
|------|------|------|
| `applications.ts` | `listApplicationProjects`, `getApplicationProject`, `createApplicationProject`, `getJobDescription`, `updateFailedJdRawText`, `getJdRequirement`, `getInsightState`, `startInsight`, `listDrafts`, `getDraft`, `saveDraftSection` | `server/actions/{application,insight,draft}` + 행 읽기 |
| `drafts.ts` | `getCareerSourceTree`, `rankDraftSources`, `createCareerDescriptionDraft`, `createCoverLetterDraft`, `addCoverLetterQuestion`, `deleteDraftSection`, `finalizeCareerDescription`, `finalizeCoverLetterSection`, `setSectionSources`, `markDraftCopied`, `retryJdExtraction`(`runJdExtraction`) | 위 + `rankDraftSourcesForProject` |
| `drafts.ts` | `markDraftEdited`, `settleAbandonedGeneration` | 실제 경로 no-op (저장이 `edited_at`을 쓰고, 끝내는 것은 라우트·작업 정리) |
| `drafts.ts` | 새 함수 `prepareCareerDescriptionStream`, `prepareCoverLetterStream` | `{ generation_id, request: { endpoint, body } }`. 시그니처 변경이 아니라 추가 |
| `evidence.ts` | `getEvidence`, `getEvidenceForOwners` (면접 화면도 씀) | 실제 행에 기존 `toEvidenceView` |
| `deletion.ts` | `getApplicationDeletionImpact`, `deleteApplicationProject`, `getDraftDeletionImpact`, `deleteDraft` | 액션 + 개수 조회 |

`getBoard`, `moveApplicationStage`, `setApplicationOutcome`, `updateApplicationProject`는 W4가 같은 파일에 이미 연결했다(`board-real.ts`). 건드리지 않았다.

방식: 화면은 표 행을 읽으므로 mock의 판정 코드(`summarize`, `buildSourceTree`, `toEvidenceView`)를 실제 행에 그대로 돌리고, 서비스가 정하는 값(실효 추출 상태, 진행 수, 초안 상태)만 덮어쓴다.

서버 쪽 변경:
- `lib/contracts/draft.ts`, `services/drafts/career-description.ts`: AI-03 입력에 선택 `draftId`. 주면 그 id로 행을 만들고 재사용은 건너뛴다.
- `server/jobs/jd-extraction.ts`: `startJdExtractionInBackground`. JD가 `running`이 되면 바로 돌아오고 나머지는 `after()`.
- `server/actions/insight.ts`: `startInsight` 액션.
- `lib/data/applications.ts`: `summarize`를 export, `advanceMock` 옵션.

요청 항목별:
- **S-14 (Q53-1)**: 키 없음 저장, `key_invalid`·`ai_consent_required`는 행 없이 거부 → `{ rejected, refusal }`. 키 있으면 추출 시작 후 바로 복귀.
- **S-15**: `raw_text_editable`·`raw_text_lock`, `updateFailedJdRawText`의 `{ refused }` 변환(`not_found` → `job_description_not_found`, `invalid_input` → `invalid_raw_text`).
- **S-17 요건 먼저, AI-11**: `retryJdExtraction`이 시작 후 복귀하고 화면 폴링이 결과를 읽는다. AI-11 실패는 `MockAiError`로 던져 기존 `_lib/actions`가 나눈다.
- **Q53-7 중단**: `finalize*`가 작업을 찾아 취소하고 끝나기를 기다린다. 다시 생성 → `{ stopped: "regeneration", back_to_draft_id }`, 첫 생성 → `{ stopped: "first_generation" }`, 먼저 성공했으면 null.
- **경력기술서 임시 행**: 스트림 전 행이 없어 설정을 30분 수명 httpOnly 쿠키에 둔다(spec-gaps W3-2).
- **`tech_keywords` null**: `[]`로 읽는다.

## 연결하지 않은 함수
| 함수 | 이유 |
|------|------|
| `saveJdRequirement`, `deleteJdRequirement` | 호출하는 화면이 없고 대응 서비스도 없다. mock 그대로 |
| `ensureJdRequirementsInDb`, `insightFeatureStatus`, `interviewFeatureStatus` | mock 저장소 전용 내부 함수(`ai-jobs.ts`·`interviews.ts`의 mock 분기가 씀) |
| `prepareCareerDescription`, `prepareCoverLetterSection` | 미리보기 전용. 실제 경로는 null |

## 확인 범위
새 시험 `src/lib/data/w3.integration.test.ts`: 화면이 부르는 data 함수 → 액션 → 서비스 → 실제 RPC·트리거·RLS. 대체한 것은 Next 요청 문맥(`cookies`·`headers`·`after`), 공급자 어댑터(스크립트 출력), 키 복호화뿐이다. 프롬프트 파이프라인과 검증은 진짜다. 동의는 지시대로 `record_consents` RPC로 줬다.

| 항목 | 실제 행으로 확인 |
|------|------------------|
| 키 없이 / 키로 생성, 키 무효·동의 철회 거부(행 안 생김) | O |
| 추출(AI-01): `running` 즉시 보임 → 요건 저장, `already` | O |
| 원문 수정: 입력 원인 실패 → 저장 → 재추출, 거부 코드 4개 | O |
| `jd_has_results` 긍정 경로 | O. 다만 AI-01이 0개 성공을 만들지 않아 요건 행을 직접 지워 만들었다 (W3-12) |
| 인사이트 시작 → 생성 중 → 읽기, `item_key`, 근거 칩 | O |
| AI-11, 소스 트리 | O |
| 경력기술서 임시 행 → 실제 라우트 + `realBlockStream` → `validated` → 저장 행 → 칩(변경됨 포함) | O |
| 자소서: 문항 CRUD, 근거 변경, AI-04 스트림, 편집, 복사, 삭제 | O |
| Q53-7 다시 생성·첫 생성 중단, 자소서 중단(본문·편집본 유지) | O. 하트비트까지 약 10초 걸린다 |
| `validated.result` 매핑(W1 숙제) | `block_id`·`text`·`notes_for_user` 맞음. **`evidence_count`는 늘 0** (W3-7, 패치 포함) |

`next start` + 실제 세션 쿠키 GET(실제 행 1건): `/applications`, 허브, `jd`, `insight`, `drafts`, 자소서 편집·문항, 임시 행 `?generate=1`, `/board`, `/interviews`, `/applications/new`는 200이고 서버 로그에 오류 없음. 없는 id 2개는 200 스트림 안의 not-found로 응답했다(digest 문자열로 판단했고 화면은 보지 않았다).

단위 시험만 / 시험 없음:
- `normalizeInsightResult`의 값 없는 경로, 변환 함수의 예외 경로는 위 흐름에 나오는 것만 확인했다.

**실행하지 않은 것**
- 브라우저 확인 전부. 클릭, 폴링, `AutoRefresh`, 스트리밍 표시, 중단 후 이동을 눈으로 보지 않았다.
- 실제 Next의 Server Action POST와 진짜 `after()`. 시험에서는 대역이다. 쿠키 쓰기 후 재렌더도 보지 못했다.
- 패치 적용 상태의 S-19. 스트림은 라우트 + 클라이언트 리더까지만 돌렸고 `useAiStream`·편집기는 돌리지 않았다.
- `?state=` 미리보기의 회귀: 빌드와 mock 분기 유지까지만이고 미리보기 화면을 다시 열어 보지 않았다.
- 실제 공급자 호출, 무료 등급 간격, 두 탭 동시 시작.

## UI 요청
1. **S-19 패치 적용** (필수). `ui-request-s19.patch`: `_lib/actions.ts`, `draft-editor.tsx`, `streaming.tsx`, `ai-stream-client.ts`. 앞 둘은 실제 스트림 시작, 뒤 둘은 임시 블록 겹침과 근거 수.
2. **중단 중 표시**: 중단 후 최대 12초 스트리밍 화면 그대로다(W3-4). "중단하는 중" 표시가 있으면 좋다.
3. **재사용 이동**: 같은 입력의 초안으로 옮겨 가려면 `done.draftId`를 편집기가 받아야 한다(W3-3). 지금은 다시 생성한다.
4. **S-18 새 문항**: 빈 문항을 저장할 수 없다. "새 문항"으로 시작하며, 입력란을 비우면 자동 저장이 실패로 보인다(W3-9). 비었을 때 저장을 건너뛰는 것이 맞아 보인다.
5. **스트림 중 다시 읽기**: S-19를 새로고침하면 실행은 계속되지만 진행을 다시 잡아 주는 코드가 없다. 끝난 뒤 새로고침해야 결과가 보인다.

## 기획 확인 (spec-gaps `W3 (api)` W3-1 ~ W3-13)
결정이 필요한 것: W3-3(재사용 포기), W3-5(중단 문항을 data 계층이 `ready`/`pending`으로 읽음. 서비스 값과 다름), W3-8(키가 있을 때 이름 규칙, DM대로 둠), W3-12(요건 0개 성공 화면이 실제로 나오지 않음). ⑲는 그대로 열려 있다.

## 시험 결과
| 명령 | 결과 |
|------|------|
| `pnpm lint` | 오류 0 |
| `pnpm typecheck` | 통과 |
| `pnpm test` | 98파일 1,595건 통과 (W3 통합 9건 포함) |
| `pnpm build` | 성공 |
| `pnpm db:test` | 돌리지 않음. SQL을 바꾸지 않았고 다른 작업자가 pgTAP 파일을 고치는 중이다 |

W2·W4 작업 파일이 같은 체크아웃에 있는 상태의 결과다. 다른 작업자의 수정이 더해지면 달라질 수 있다.
