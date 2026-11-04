# R8 요약 — STAR 합친 제안 · -음 체 · 민감정보 판정 완화

- 날짜: 2026-11-04 · 상태: done (열린 Minor 1) · R7 위에 쌓임, 미커밋
- 사용자 결정: RQ-4 -음 체(STAR 제안·산출물 초안), RQ-5 합친 전체 제안 + [반영] = 교체, RQ-6 민감정보 = 본인·가족 신상·연락처·실명만.
- 리더 판단: R8-QA-4 `review_reason`(existing_missing / content_unverified), QA-03 판정 방향(신상 서술이 화자의 절 서술어일 때만), QA-07·08 일부 직접 수정.

## 바뀐 것
- DB: `20261113000300_r8_star_merged_proposal.sql` — `private.wc_patch_star` 교체. 값 있는 필드의 AI set = 제안 교체, 합친 set 위 append도 set 유지, 사용자 편집은 set 유지, `review_reason` 저장. 비파괴. 로컬 적용 → 원격 적용 2026-11-04(사용자, `list_migrations`로 확인).
- AI: AI-12 extract v6(합친 set, -음 체), reply v6, AI-13 extract v3·compose v2(-음 체). V-9h 개정, V-9j(기존 숫자·이름 보존) 신설, 기존 텍스트를 출처로 인정, 모델 append → 합친 set 변환. -음 체·ㅁ 명사형 어미 정규화. 민감정보 판정 재작성(값에만, 신상 서술어일 때만, 직함 오탐 제외), 회귀 픽스처 work 55·personal 38.
- 화면: [반영] set = 교체(되돌리기), 카드 "기존 내용과 합친 제안" + "기존 내용과 비교", V-9j 안내 문구, mock.
- 기획: AI v4.9, DM v4.9, UX v5.11, PRD v4.11, decisions 3.16·4.10.

## 검사
- 2라운드: typecheck·lint·vitest 2,174·build·pgTAP 56 파일 2,731 통과. 리더 수정 후 vitest src/server/ai 1,125 통과.
- 로컬 DB 공유로 행 수 단언 pgTAP 4개가 한때 실패했으나 재현 안 됨(R8 무관).
- HTTP 스모크 SKIP, 실제 공급자 대화 미확인, 브라우저 미확인.

## 열린 것
- QA-07 잔여(Minor): 일부 -음 체 신상 서술 누락(문장은 03 리포트). 모델 sensitive_flags가 보조.
- 출시: 마이그레이션 1개 → db push 먼저, 그다음 UI 포함 같은 머지. 환경 변수 없음.
