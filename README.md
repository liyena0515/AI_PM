# PM-RAG · AI 기반 프로젝트 관리 플랫폼

KICA AX워크숍 2일차 산출물 — **PRD → 목업(PNG 10종) → 클릭 프로토타입 → 실행 가능한 MVP**로 이어지는 RAG(검색증강생성) 기반 프로젝트 관리 프로그램입니다.

진척률, 이슈, 산출물, 회의록 등 프로젝트 데이터를 검색해 근거 기반으로 질문에 답하고 회의록을 자동 요약하는 것이 핵심 기능입니다. `ANTHROPIC_API_KEY`를 설정하면 Claude가 실제 자연어 답변을 생성하고, 설정하지 않아도 검색 결과 기반 규칙형 폴백으로 동일한 화면·기능이 그대로 동작합니다.

---

## 1. 이 저장소의 구성

| 경로 | 설명 |
|---|---|
| [`index.html`](./index.html) | 프로젝트 소개 랜딩 페이지(이 문서의 웹 버전) |
| [`PM-RAG_standalone.html`](./PM-RAG_standalone.html) | **가장 빠르게 확인하는 방법.** 폰트·데이터가 모두 내장된 단일 HTML 데모(백엔드 불필요) |
| [`serve_localhost.ps1`](./serve_localhost.ps1) | 위 스탠드얼론 HTML을 `localhost:8787`로 띄워주는 PowerShell 실행 스크립트 |
| [`pm_rag_mvp/mvp/`](./pm_rag_mvp/mvp) | 실제 SQLite DB + TF-IDF 검색 + Claude API 연동이 포함된 **전체 MVP 소스** (backend/frontend) |
| `pm_rag_mvp.zip` | 위 MVP 소스 전체를 압축한 배포용 아카이브 |

## 2. 빠르게 실행하기

### 방법 A — 스탠드얼론 데모 (설치 없이 바로 확인)

Windows에서 `serve_localhost.ps1`을 더블클릭하거나 PowerShell에서 실행하세요.

```powershell
./serve_localhost.ps1
```

브라우저가 자동으로 `http://localhost:8787`을 열고 `PM-RAG_standalone.html`을 보여줍니다. 데이터는 그 안에 내장되어 있어 별도 서버·DB 없이 화면 전체(10개 화면)를 둘러볼 수 있습니다.

### 방법 B — 전체 MVP (실제 DB + RAG 검색 + Claude 연동)

```bash
cd pm_rag_mvp/mvp/backend
pip install -r requirements.txt
python3 server.py
```

브라우저에서 `http://localhost:8787` 접속. 최초 실행 시 `pmrag.db`가 자동 생성되고 예시 데이터로 시드됩니다. 실제 LLM 응답을 받으려면 실행 전 환경변수를 설정하세요.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
python3 server.py
```

자세한 아키텍처·API 명세·알려진 제한사항은 [`pm_rag_mvp/mvp/frontend/README.md`](./pm_rag_mvp/mvp/frontend/README.md)를 참고하세요.

## 3. 화면 구성 (10개)

| 코드 | 화면 | 주요 기능 |
|---|---|---|
| 00 | 메인 대시보드 | 종합 진척률, 지연/이슈/승인율 요약, 조직별 현황, 최근 알림 |
| 01 | 진척률 관리 | WBS 태스크별 계획 대비 실적 입력·수정, 지연 자동 판정 |
| 02 | 질의응답 | RAG 기반 자연어 질의, 출처 문서 표시, 빠른 질문 칩 |
| 03 | 이슈 로그 | 이슈 등록/상태 변경, 영향도·긴급도 기반 하이라이트 |
| 04 | 회의록 자동요약 | 회의 메모 입력 → AI 초안 생성 → 확정·배포 |
| 05 | 액션아이템 | 담당 조직·기한 기준 칸반 보드, 상태 변경 |
| 06 | 산출물 관리 | 문서 유형·담당 조직·목표일·승인 상태 관리 |
| 07 | 주간 리포트 | 종합 진척률, 지연 항목, 이슈 요약, 산출물 분포 자동 집계 |
| 08 | 알림센터 | 지연/긴급/정보 알림 필터링, 실시간 목록 |
| 09 | 관리자 설정 | 지연 판정 임계값, 조직별 권한, 알림 채널, 데이터 소스 상태 |

## 4. 기술 스택

- **프런트엔드**: 빌드 도구 없는 바닐라 HTML/CSS/JS. Daki 서체(WOFF base64 임베드), KICA 브랜드 4색 기반 Toss 스타일 디자인 시스템.
- **백엔드**: Python 표준 라이브러리(`http.server`, `sqlite3`)만으로 구현한 REST API. 외부 프레임워크 의존성 없음(폐쇄망 환경 대응).
- **검색(Retrieval)**: `TfidfVectorizer(analyzer="char_wb", ngram_range=(2,4))` + 코사인 유사도. 형태소 분석기 없이 문자 n-gram만으로 한국어 검색을 처리.
- **생성(Generation)**: Anthropic Messages API에 `requests`로 직접 REST 호출.

## 5. 알려진 제한사항

- 인증/권한 미구현(단일 사용자 가정)
- 데이터 소스 연동은 SQLite 레코드 수 표시 수준의 시뮬레이션
- 검색은 TF-IDF 기반(임베딩 아님)
- SQLite + 단일 프로세스라 다수 동시 쓰기 환경에는 부적합
- 일부 버튼(PDF 다운로드 등)은 프로토타입 수준의 자리표시자

자세한 내용은 [`pm_rag_mvp/mvp/frontend/README.md`](./pm_rag_mvp/mvp/frontend/README.md)의 8·9번 항목을 참고하세요.

---

&copy; 2026 KICA Inc. (Internal Use Only)
