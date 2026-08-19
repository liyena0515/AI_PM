# PM-RAG MVP

RAG 기반 프로젝트 관리 프로그램 — PRD → 목업(PNG 10종) → 클릭 프로토타입 → **실행 가능한 MVP**로 이어지는 마지막 단계 산출물입니다.

정적 HTML 프로토타입이 아니라, 실제 데이터베이스(SQLite)에 데이터를 저장하고, TF-IDF 기반 검색으로 관련 문서를 찾아 답변을 생성하는 **동작하는 애플리케이션**입니다. `ANTHROPIC_API_KEY`를 설정하면 검색된 문서를 근거로 Claude가 자연어 답변·회의록 요약을 실제로 생성하고, 설정하지 않으면 검색 결과 기반 규칙형 폴백 답변으로 동일한 화면·API가 그대로 동작합니다.

---

## 1. 빠르게 실행하기

```bash
cd backend
pip install -r requirements.txt
python3 server.py
```

브라우저에서 `http://localhost:8787` 접속. 최초 실행 시 `backend/pmrag.db`가 자동 생성되고, 예시 데이터(진척률 8건, 이슈 6건, 산출물 6건, 액션아이템 7건, 회의록 1건 등)로 시드됩니다. DB 파일을 지우고 다시 실행하면 처음 상태로 리셋됩니다.

포트를 바꾸려면 `PORT` 환경변수를 지정하세요.

```bash
PORT=9000 python3 server.py
```

## 2. 실제 LLM(Claude) 연동하기

API 키가 없어도 모든 기능이 정상 동작합니다(검색 기반 폴백). 실제 자연어 생성을 켜려면:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
python3 server.py
```

연동되면 화면 상단 배너가 `FALLBACK MODE`에서 연결 상태로 바뀌고, 질의응답·회의록 자동요약이 검색된 근거 문서를 바탕으로 Claude가 생성한 자연어 답변으로 전환됩니다. 모델은 `ANTHROPIC_MODEL` 환경변수로 바꿀 수 있습니다(기본값 `claude-sonnet-4-5-20250929`).

## 3. 아키텍처

```
frontend/  (바닐라 JS SPA, 프레임워크 의존성 없음)
  index.html   — 앱 셸(사이드바/탑바/콘텐츠 영역)
  app.js       — 라우팅, 10개 화면 렌더링, API 호출, 이벤트 위임
  styles.css   — Toss 스타일 디자인 시스템(Daki 폰트, KICA 컬러)
  fonts_embed.css — Daki 폰트 4종(WOFF, base64 임베드, 완성형 한글 전체)

backend/   (Python 표준 라이브러리 기반, 프레임워크 없음)
  server.py    — http.server 기반 REST API + 정적 파일 서빙
  db.py        — SQLite 스키마 정의 + 예시 데이터 시드
  rag.py       — TF-IDF 검색(scikit-learn) + Claude API 연동(requests)
  pmrag.db     — SQLite 데이터베이스 파일(최초 실행 시 자동 생성)
```

- **검색(Retrieval)**: 진척률/이슈/산출물/회의록 레코드를 문서화한 뒤 `TfidfVectorizer(analyzer="char_wb", ngram_range=(2,4))`로 벡터화하고 코사인 유사도로 질문과 매칭합니다. 한국어 형태소 분석기 없이도 char n-gram만으로 실용적인 검색 품질을 확보했습니다.
- **생성(Generation)**: 검색된 상위 문서를 컨텍스트로 Anthropic Messages API(`https://api.anthropic.com/v1/messages`)에 직접 요청합니다. 공식 SDK 대신 `requests`로 REST 호출을 구현했습니다(사유는 8번 항목 참고).
- **프런트엔드**: 빌드 도구 없는 순수 HTML/CSS/JS. 10개 화면을 `app.js`의 `RENDERERS` 맵으로 관리하고, 클릭/변경 이벤트는 `data-action` 속성 기반 이벤트 위임으로 처리합니다.

## 4. 화면 구성 (10개)

| 코드 | 화면 | 주요 기능 |
|---|---|---|
| 00 | 메인 대시보드 | 종합 진척률, 지연/이슈/승인율 요약, 조직별 현황, 최근 알림 |
| 01 | 진척률 관리 | WBS 태스크별 계획 대비 실적 입력·수정, 지연 자동 판정 |
| 02 | 질의응답 | RAG 기반 자연어 질의, 출처 문서 표시, 빠른 질문 칩 |
| 03 | 이슈 로그 | 이슈 등록/상태 변경, 영향도·긴급도 기반 하이라이트 |
| 04 | 회의록 자동요약 | 회의 메모 입력 → AI 초안 생성(지난주 점검/결정사항/신규 액션) → 확정·배포 |
| 05 | 액션아이템 | 담당 조직·기한 기준 칸반 보드, 상태 변경 |
| 06 | 산출물 관리 | 문서 유형·담당 조직·목표일·승인 상태 관리 |
| 07 | 주간 리포트 | 종합 진척률, 지연 항목, 이슈 요약, 산출물 분포 자동 집계 |
| 08 | 알림센터 | 지연/긴급/정보 알림 필터링, 실시간 목록 |
| 09 | 관리자 설정 | 지연 판정 임계값, 조직별 권한, 알림 채널, 데이터 소스 상태 |

## 5. 주요 API

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/health` | 서버·LLM 연결 상태 |
| GET | `/api/dashboard` | 대시보드 집계 데이터 |
| GET/PATCH | `/api/progress`, `/api/progress/{id}` | 진척률 조회/실적 수정 |
| GET/POST/PATCH | `/api/issues`, `/api/issues/{id}` | 이슈 조회/등록/상태 변경 |
| GET/PATCH | `/api/deliverables`, `/api/deliverables/{id}` | 산출물 조회/상태 변경 |
| GET/POST/PATCH | `/api/actions`, `/api/actions/{id}` | 액션아이템 조회/등록/상태 변경 |
| GET/POST | `/api/minutes`, `/api/minutes/draft`, `/api/minutes/confirm` | 회의록 조회/AI 초안 생성/확정 |
| GET | `/api/notifications` | 알림 목록(`?kind=` 필터) |
| POST | `/api/qna` | RAG 질의응답 |
| GET/POST | `/api/admin/settings` | 지연 임계값 등 설정 조회/변경 |
| GET/POST | `/api/admin/orgs`, `/api/admin/orgs/{org}` | 조직별 권한 조회/변경 |
| GET | `/api/admin/datasources` | 데이터 소스 연동 상태 |

모든 응답은 JSON이며 CORS가 허용되어 있어 프런트엔드를 별도 포트에서 띄워도 동작합니다.

## 6. 데이터

`db.py`의 `seed()`가 기존 목업/프로토타입에서 사용한 예시 데이터(진척률 8건, 이슈 6건, 산출물 6건 등)를 그대로 SQLite에 채웁니다. 실제 운영 데이터로 바꾸려면 `pmrag.db`를 초기화한 뒤 API(POST 엔드포인트)로 데이터를 넣거나, `db.py`의 `seed()` 함수를 실제 데이터에 맞게 수정하세요.

## 7. 테스트

`test_ui.py`는 Playwright로 10개 화면 전체를 클릭해보고 콘솔 에러를 수집하는 엔드투엔드 테스트입니다.

```bash
pip install playwright && playwright install chromium
python3 server.py &          # 백엔드 먼저 실행
python3 test_ui.py           # 별도 터미널에서 실행
```

정상 종료 시 `CONSOLE/PAGE ERRORS: []`와 `DONE`이 출력되고, `/tmp/mvp_*.png`에 각 화면 스크린샷이 저장됩니다.

## 8. 알려진 제한사항

- **인증/권한 미구현**: `/api/admin/orgs`에 조직별 열람·수정·승인 권한 데이터는 있지만, 실제 로그인/세션 기반 접근 제어는 적용되어 있지 않습니다(단일 사용자 가정).
- **데이터 소스 연동은 시뮬레이션**: "데이터 소스 연동 상태" 화면은 SQLite 내 레코드 수를 보여주는 것이며, 실제 외부 문서 저장소(SharePoint, Google Drive 등)를 감시(watch)하는 기능은 없습니다.
- **검색은 TF-IDF, 임베딩 아님**: 문장 의미 기반 dense embedding이 아닌 문자 n-gram 기반 검색이라 어휘가 완전히 다른 동의어 질의에는 정확도가 떨어질 수 있습니다. 프로덕션 전환 시 임베딩 기반 검색(예: OpenAI/Voyage 임베딩 + 벡터 DB)으로 교체를 권장합니다.
- **동시성 미보증**: SQLite + 단일 프로세스 스레드 서버로 구현되어 있어 다수 사용자의 동시 쓰기가 잦은 환경에는 적합하지 않습니다. 실제 배포 시 PostgreSQL 등으로 전환이 필요합니다.
- **PDF 다운로드 등 일부 버튼은 UI만 존재**: 주간 리포트의 "PDF 다운로드"·"공유 링크 복사" 버튼은 프로토타입 수준의 자리표시자입니다.
- **패키지 제약**: 이 환경에서는 `fastapi`, `anthropic`(공식 SDK), `brotli` 패키지 설치가 제한되어 있어, 백엔드는 Python 표준 라이브러리(`http.server`, `sqlite3`) + `requests` + `scikit-learn`만으로 구현했습니다. 일반 환경에서는 필요에 따라 FastAPI 등으로 리팩터링해도 무방합니다.

## 9. 다음 단계 제안

- 로그인/세션 기반 인증 및 조직별 접근 제어 실제 적용
- 임베딩 기반 검색(벡터 DB)으로 전환해 검색 품질 향상
- 실제 문서 저장소(사내 위키, 드라이브 등) 연동 및 자동 인제스천 파이프라인 구축
- SQLite → PostgreSQL 등 운영급 DB로 전환, 동시성 처리 보강
- 이메일/사내 메신저 알림 실제 발송 연동(현재는 UI 토글만 존재)
