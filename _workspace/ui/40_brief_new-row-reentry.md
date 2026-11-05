# 40 런 — "+ 프로젝트 추가 / + 산출물 추가"가 방금 만든 행을 다시 여는 버그

- 요청(사용자, 2026-11-05): "산출물 추가 / 프로젝트 추가 버튼 클릭하면 새로운 프로젝트 추가 페이지가 아니라 방금 생성했던 프로젝트/산출물로 넘어가."
- 범위: S-10 새 프로젝트, S-44 새 산출물 (A2). 기획 변경 없음, 백엔드 변경 없음.

## 원인 (재현으로 확인)
Next 16은 떠난 라우트의 React 트리를 언마운트하지 않고 숨겨 두고(`<Activity>`) 같은 주소로 돌아오면
**클라이언트 상태를 그대로 되살린다**(서버 데이터만 새로 받는다). 두 새 행 페이지는 첫 저장 때 행을 만들고
`window.history.replaceState`로 URL만 바꾸므로(컴포넌트를 마운트된 채 두는 설계 — 33 런) 그 숨은 트리의
상태 = 방금 만든 행이다. 그래서 새 행 주소로 다시 들어오면 서버는 빈 새 행을 주는데도 화면은 방금 만든
프로젝트·산출물을 보여 준다.

재현: 저장소와 같은 Next 설정(`cacheComponents`, `partialPrefetching`)에서 `/dev/` 아래 임시 라우트
(부모 → `new` → 저장(replaceState) → 부모 → `new`)로 헤드리스 크롬 클릭. 4번째 단계에서 서버 렌더는
새 행(`serverId: null`, 새 타임스탬프)인데 화면은 `existing abc123`. 임시 라우트는 확인 후 삭제.

## 수정
- `src/components/career/new-row-remount.tsx` (신규): `useNewRowRemount()` — 행이 생기면 `markRow(rowId)`로
  표시해 두고, 트리가 다시 보일 때 주소에 그 행 ID가 없으면(= 새 행 주소로 돌아왔으면) `key`를 바꿔 본문을
  서버 데이터로 다시 마운트한다. 기존 행 주소(뒤로·앞으로 포함)에서는 그대로 둔다.
- `project-page.tsx` / `deliverable-page.tsx`: 본문을 `ProjectPageBody` / `DeliverablePageBody`로 두고
  겉면에서 `key`로 감쌈. URL을 행 주소로 바꾸는 곳에서 `markRow` 호출.
- `new-row-remount.test.ts` (신규): 소스 가드(33 런 `new-row-notice.test.ts` 관례).

## 확인
- lint / typecheck / vitest 2386개 통과.
- 메커니즘은 위 임시 라우트로 확인. **실제 S-10·S-44 화면의 브라우저 확인은 못 했다** — 이 세션에 브라우저
  도구가 연결되지 않았고 로컬 로그인은 Google 전용이라 세션을 만들 수 없었다.
