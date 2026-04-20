# macdosa work-state
> PM2: `macdosa-server` | 마지막 업데이트: 2026-04-21

---

## 현재 진행 중인 작업

**베타 운영 중 — 링크 품질 개선 사이클 마무리**
- ✅ `aa3401c` NOT_APPLE 블랙리스트→화이트리스트 전환 (Apple 공식 도메인만 허용)
- ✅ `8e250ae` 사업자 계산 버튼 + VAT 환급 표시 + 이메일 검증 강화
- ✅ `7a15cea` 구매링크 searchUrl fallback — 죽은 링크 대신 스토어 검색 페이지로
- 시뮬 결과 (2026-04-20): avgScore **3.9** / willPayRate **80%** / pathPassRate **69.7%**
- 화이트리스트 전환 후 pathPassRate 재측정 필요

---

## 다음 할 일 (우선순위 순)

1. **pathPassRate 재시뮬** — NOT_APPLE 화이트리스트 전환 이후 실제 개선 수치 확인 (`node test/qa-loop.js`)
2. **학생할인·카드사 할인 정보 추가** — 고객 피드백 top 항목, `server.js` 프롬프트에 교육할인/카드사별 비교 지시 추가
3. **Phase 1 결제 연동 준비** — 토스페이먼츠 sandbox 키 세팅 + `server.js` `/payment` 라우트 스캐폴딩

---

## 마지막 수정 파일

| 파일 | 커밋 | 주요 내용 |
|------|------|-----------|
| `result.html` | `aa3401c` | NOT_APPLE 화이트리스트 전환 (블랙리스트 방식 폐기) |
| `result.html` | `8e250ae` | 사업자 계산 버튼 활성화 + VAT 환급 표시 개선 |
| `server.js` | `8e250ae` | 이메일 검증 강화 (정규식 + 도메인 체크) |
| `result.html` | `7a15cea` | searchUrl fallback — 죽은 링크 대신 스토어 검색 페이지로 |
| `test/customer-sim.js` | `6bb3e70` | 순차→병렬(Promise.all) 전환 |

---

## 최근 완료된 작업 (커밋)

| 커밋 | 내용 |
|------|------|
| `aa3401c` | fix: NOT_APPLE 블랙리스트→화이트리스트 전환 ✅ |
| `8e250ae` | fix: 사업자 계산 버튼 + VAT 환급 표시 + 이메일 검증 강화 ✅ |
| `7a15cea` | feat: 구매링크 searchUrl fallback ✅ |
| `6bb3e70` | perf: 고객 시뮬 순차→병렬 실행 (Promise.all) ✅ |
| `d3cfa55` | fix: 링크 검증 로직 개선 — GET + 403/418 bot 탐지 정상 처리 ✅ |

---

## Phase 로드맵

| Phase | 내용 | 상태 |
|-------|------|------|
| Phase 0 베타 | 이메일 수집 + 카톡 공유 + 유저 피드백 수집 | 🔄 진행 중 |
| Phase 1 MVP | 결제 연동 + 분석 엔진 + 블러 해제 + Supabase | 🔜 다음 |
| Phase 2 구독 | Pro 정기결제 + 카드 조합 DB + 부가세 계산기 | ⬜ 미착수 |
| Phase 3 알림 | 가격 추적 크론 + 알림 발송 + 원데이딜 모니터링 | ⬜ 미착수 |
