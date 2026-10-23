---
name: data-model-spec
description: "Resumate 데이터 모델 기획 문서 작성·수정 가이드. 도메인 엔티티(사용자, 경력, 프로젝트, 성과, 스킬, 이력서 파일, JD, 인사이트, 채팅, 모의 면접 세션)와 관계, Supabase Postgres 테이블 초안, RLS 정책 방향, Storage 구조, AI 출력 저장·버전 관리, 삭제 정책, API 경계 초안을 다룬다. ERD, 데이터 모델, 스키마 설계, 테이블 구조, RLS 설계, 데이터 모델 수정 요청 시 사용. 실제 마이그레이션 적용·SQL 실행에는 쓰지 않는다(문서만 작성)."
---

# 데이터 모델 명세

이 문서는 구현 단계에서 마이그레이션 SQL로 옮겨질 설계도다. **이 단계에서는 문서만 쓰고 DB는 건드리지 않는다.**

## 작성 순서

1. PRD 기능과 ux-planner·ai-feature-designer의 필드 요청을 모은다.
2. 엔티티와 관계를 정하고 ERD를 그린다.
3. 테이블별 컬럼을 정의한다.
4. RLS, Storage, 삭제 정책을 정한다.
5. 기능 ↔ 엔티티 매트릭스와 API 경계 초안을 쓴다.
6. 필드 요청자에게 확정된 이름을 회신한다.

## 시작점 엔티티 (조정 가능)

`profiles`(auth.users 1:1), `experiences`, `projects`, `achievements`, `skills` + 연결 테이블, `resume_files`, `job_postings`, `jd_analyses`, `insights`, `chat_threads`, `chat_messages`, `interview_sessions`, `interview_turns`(질문·답변·피드백), `interview_reports`.
필요 없으면 빼고, 필요하면 추가한다. 넣고 뺀 이유를 한 줄씩 남긴다.

## Supabase 설계 규칙

- 모든 사용자 소유 테이블: `user_id uuid references auth.users` + RLS `user_id = auth.uid()` (select/insert/update/delete 각각 방향 명시).
- 공통 컬럼: `id uuid default gen_random_uuid()`, `created_at`, `updated_at`.
- AI 출력: 화면이 필드 단위로 조회·필터하면 컬럼으로, 통째로 렌더링하면 `jsonb` + `schema_version`. 재생성 이력이 필요하면 덮어쓰지 않고 행을 추가한다.
- 근거(evidence)는 원본 엔티티 id를 참조한다. 원본이 삭제되면 근거 표시를 어떻게 할지 정한다.
- 파일: Storage 버킷 + 경로 규칙(`{user_id}/...`) + 버킷 정책. 파싱 결과는 테이블에 저장.
- 순서가 있는 항목(경력 정렬, 면접 턴): 정렬 컬럼을 명시한다.
- 임베딩(pgvector)은 ai-feature-designer가 RAG를 택했을 때만 추가한다.

## 삭제·보관 정책

- 개별 삭제: 경력 삭제 시 연결 프로젝트·성과·근거 참조 처리(cascade / set null / soft delete)를 엔티티별로 정한다.
- 탈퇴: 전체 데이터와 Storage 파일 삭제 범위, 유예 기간 `[결정 필요]`.
- 보관 기간은 제품 결정이므로 product-planner에게 확인한다.

## 문서 템플릿

```markdown
# Resumate 데이터 모델 v{N}

## 1. ERD
```mermaid
erDiagram
  profiles ||--o{ experiences : has
  ...
```
## 2. 테이블 정의
### {table}
- 설명 / 관련 기능 ID / 요청자(ux S-xx, ai AI-xx)
| 컬럼 | 타입 | 제약 | 설명 |
- RLS: select/insert/update/delete 방향
- 인덱스 후보:

## 3. Storage
## 4. 삭제·보관 정책
## 5. 기능 ↔ 엔티티 매트릭스
| 기능 ID | 읽기 | 쓰기 |
## 6. API 경계 초안
| 작업 | 방식(Server Action / Route Handler / 스트리밍) | 읽기·쓰기 테이블 | 관련 화면 |
## 7. 결정 필요 목록
## 8. 변경 기록
```

## 품질 기준

- ux-planner 화면 명세와 ai-feature-designer 입력 컨텍스트의 모든 `entity.field`가 테이블 정의에 존재한다.
- 모든 사용자 데이터 테이블에 RLS 방향이 있다. 하나라도 빠지면 다른 사용자 경력이 노출될 수 있다.
- 테이블·컬럼 이름은 snake_case, 용어집과 일치.
