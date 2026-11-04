# 33 런 브리프 — 새 프로젝트·새 산출물 페이지 "추가 중"임을 알리기

- 날짜: 2026-11-04
- 요청(사용자 원문): "프로젝트 추가 버튼을 누르면 새로운 프로젝트가 추가되지 않고 기존 프로젝트 상세 화면으로 넘어가" / "산출물도 동일해" /
  화면 확인 답변: "내용은 없는데 제목이 붙어서 나와"
- 사용자 결정(2026-11-04, 질문 응답): **화면 전환 구조는 그대로 유지**(PA-3 — 경력·교육 상세의 "+ 프로젝트 추가"는 모달 없이
  S-10 새 페이지로, 행은 첫 저장 때 생성). **표시만 "새 프로젝트/새 산출물 추가"답게** 바꾼다. 추가 모달로 통일하는 안은 사용자가 고르지 않았다.

## 원인 (리더 조사)
- `career-overview.tsx` ProjectsSection "+ 프로젝트 추가" → `routes.projectPageNew({experience|education})` → `/career/projects/new?...`
- 그 페이지(`(page)/(gated)/career/projects/new/page.tsx` → `getNewProjectPage`)는 `project_id: null` + `blankProjectValues`로 빈 폼을 그린다.
- `project-page.tsx:484` CrumbRow가 `{경력명} › (새 프로젝트) › 프로젝트 상세` — 기존 행 편집 화면과 머리글이 같고, 칸은 모두 비어 있어
  사용자는 "기존 프로젝트 상세로 잘못 넘어왔다"고 읽는다. 저장 전에는 행이 없다는 사실이 화면에 없다.
- 산출물도 동일: `/career/projects/{id}/deliverables/new` (S-44 새 산출물, `deliverable-page.tsx`).

## 범위 (A2 영역, 표시 전용)
- S-10 새 프로젝트: `/career/projects/new?experience=|education=`
- S-44 새 산출물: `/career/projects/{id}/deliverables/new`
- 기존 행 화면(`/career/projects/[id]`, `/career/deliverables/[id]`)은 **지금 모양 유지** — 두 화면이 눈에 띄게 구분되어야 한다.

## 요구
1. 크럼/현재 위치 문구가 "새 프로젝트 추가"·"새 산출물 추가"로 읽히게 한다(기존 행은 "프로젝트 상세"·"산출물 상세" 유지).
2. 머리에 "아직 저장되지 않았고 '저장하기'를 누르면 추가된다"는 안내를 둔다. 저장 버튼 상태 문구와 모순되지 않게.
3. 새 화면과 기존 화면이 시각적으로 구분되게 — 디자인 시스템 토큰 안에서. 새 컴포넌트가 필요하면 C-xx 패턴을 따르고 `[UI-가정]` 주석.
4. `?state=` 미리보기가 깨지지 않게, 입력 보존 배너·관련 요건 배너와 겹치지 않게.
5. 기획 문서는 건드리지 않는다. 명세와 어긋나는 판단은 `[UI-가정]` + 보고서의 "기획 확인 필요"로.
6. 데이터 계층·서버 파일은 건드리지 않는다(표시 전용). 필요하면 "파운데이션 요청"으로 올린다.

## 산출물
- 코드 수정 + `_workspace/ui/33_frontend-engineer-A2_report.md`
- lint·typecheck·test 통과 확인
