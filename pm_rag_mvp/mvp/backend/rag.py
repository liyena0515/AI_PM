# -*- coding: utf-8 -*-
"""경량 RAG 파이프라인.

Retrieval: scikit-learn TF-IDF + 코사인 유사도로 4대 관리표(진척률·이슈·산출물·회의록) 레코드를
   실시간 인덱싱해 질문과 가장 관련 있는 레코드를 찾는다. (요청마다 최신 DB 상태로 재색인하므로
   진척률을 갱신하거나 이슈를 등록한 직후에도 바로 검색에 반영된다.)

Generation: ANTHROPIC_API_KEY 환경변수가 설정되어 있으면 Claude API(Messages API)를 실제로 호출해
   검색된 근거만으로 답변을 생성한다(환각 방지를 위해 컨텍스트 밖 정보는 답하지 않도록 시스템 프롬프트로 강제).
   키가 없으면 검색 결과를 그대로 요약해 보여주는 추출 요약 폴백으로 동작한다 — 이 경우에도 화면에는
   "LLM 미연동 폴백" 임을 명시한다.
"""
import os
import json
import datetime
import requests
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929")
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"


def llm_connected():
    return bool(ANTHROPIC_API_KEY)


def _doc_from_progress(row):
    diff = row["actual"] - row["plan"]
    status = "지연" if diff <= -5 else "정상"
    text = (f"[진척률] {row['task']} 담당:{row['org']} 계획:{row['plan']}% 실적:{row['actual']}% "
            f"차이:{diff:+.0f}%p 상태:{status}")
    return {"text": text, "source": "01_progress.md", "date": row["updated_at"][:10]}


def _doc_from_issue(row):
    text = (f"[이슈 {row['id']}] {row['content']} 영향도:{row['impact']} 긴급도:{row['urgency']} "
            f"담당:{row['org']} 상태:{row['status']} 목표해결일:{row['due']}")
    return {"text": text, "source": "03_issue_log.md", "date": row["updated_at"][:10]}


def _doc_from_deliverable(row):
    text = (f"[산출물 {row['id']}] {row['name']} 유형:{row['doc_type']} 담당:{row['org']} "
            f"목표일:{row['due']} 상태:{row['status']} 진행률:{row['progress_pct']}%")
    return {"text": text, "source": "04_deliverables.md", "date": row["updated_at"][:10]}


def _doc_from_minutes(row):
    decisions = json.loads(row["decisions"] or "[]")
    text = f"[회의록 {row['meeting_date']}] 결정사항: " + "; ".join(decisions)
    return {"text": text, "source": "02_meeting_minutes.md", "date": row["meeting_date"]}


def build_corpus(conn):
    """DB의 모든 레코드를 검색 가능한 문서 리스트로 변환."""
    docs = []
    for row in conn.execute("SELECT * FROM progress"):
        docs.append(_doc_from_progress(row))
    for row in conn.execute("SELECT * FROM issues"):
        docs.append(_doc_from_issue(row))
    for row in conn.execute("SELECT * FROM deliverables"):
        docs.append(_doc_from_deliverable(row))
    for row in conn.execute("SELECT * FROM minutes"):
        docs.append(_doc_from_minutes(row))
    return docs


def retrieve(conn, question, top_k=5):
    docs = build_corpus(conn)
    if not docs:
        return []
    corpus = [d["text"] for d in docs]
    # 한국어 조사/어미 때문에 형태소 분석 없이도 어느 정도 매칭되도록 char n-gram 사용
    vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=1)
    matrix = vectorizer.fit_transform(corpus + [question])
    q_vec = matrix[-1]
    doc_vecs = matrix[:-1]
    sims = cosine_similarity(q_vec, doc_vecs)[0]
    ranked = sorted(zip(sims, docs), key=lambda x: x[0], reverse=True)
    results = [d for score, d in ranked if score > 0.02][:top_k]
    if not results:
        results = [d for _, d in ranked[:top_k]]
    return results


def call_claude(system_prompt, user_prompt, max_tokens=600):
    """Anthropic Messages API 직접 호출 (SDK 없이 requests로). 실패 시 None 반환."""
    if not ANTHROPIC_API_KEY:
        return None
    try:
        resp = requests.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": max_tokens,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        parts = data.get("content", [])
        text = "".join(p.get("text", "") for p in parts if p.get("type") == "text")
        return text.strip() or None
    except Exception as e:
        return {"error": str(e)}


def answer_question(conn, question):
    sources = retrieve(conn, question, top_k=5)
    if not sources:
        return {
            "answer": "관련 정보를 찾을 수 없습니다. 4대 관리표에 아직 데이터가 없거나 질문과 관련된 레코드가 없습니다.",
            "sources": [],
            "llmConnected": llm_connected(),
        }

    context = "\n".join(f"- {s['text']} (출처: {s['source']} · {s['date']})" for s in sources)

    if llm_connected():
        system_prompt = (
            "당신은 사내 프로젝트 관리 RAG 어시스턴트 PM-RAG입니다. "
            "아래 제공된 컨텍스트(4대 관리표에서 검색된 근거)만 사용해서 한국어로 간결하게 답변하세요. "
            "컨텍스트에 없는 내용은 추측하지 말고 '자료에서 확인되지 않습니다'라고 답하세요. "
            "답변 끝에 참고한 출처 파일명을 자연스럽게 언급하세요."
        )
        user_prompt = f"[컨텍스트]\n{context}\n\n[질문]\n{question}"
        result = call_claude(system_prompt, user_prompt)
        if isinstance(result, str):
            return {"answer": result, "sources": sources, "llmConnected": True}
        # LLM 호출 실패 시 폴백으로 이어짐 (네트워크 문제 등)
        fallback_note = f" (LLM 호출 실패: {result['error']} — 검색 결과 기반 폴백 답변으로 대체)" if isinstance(result, dict) else ""
    else:
        fallback_note = ""

    # 폴백: 검색된 근거를 추출 요약 형태로 그대로 제시
    bullet = "\n".join(f"· {s['text']}" for s in sources[:4])
    answer = (
        f"[검색 기반 요약 — LLM 미연동 폴백{fallback_note}]\n"
        f"질문과 관련된 자료 {len(sources)}건을 찾았습니다.\n{bullet}\n\n"
        f"※ ANTHROPIC_API_KEY를 설정하면 이 검색 결과를 근거로 실제 Claude가 자연어로 답변을 생성합니다."
    )
    return {"answer": answer, "sources": sources, "llmConnected": False}


def summarize_minutes(raw_notes, open_actions):
    """회의 메모(raw_notes)를 구조화된 초안으로 변환. LLM 연동 시 실제 요약, 아니면 규칙 기반 폴백."""
    open_actions_text = "\n".join(f"- {a['title']} (담당:{a['org']}, 기한:{a['due']}, 상태:{a['status']})" for a in open_actions)

    if llm_connected():
        system_prompt = (
            "당신은 사내 주간회의 회의록 자동 요약기입니다. 입력된 회의 메모와 기존 액션아이템 목록을 참고해 "
            "아래 JSON 스키마로만 응답하세요(다른 텍스트 금지):\n"
            '{"last_week_check":[{"title":"...","status":"완료|진행중|미착수"}],'
            '"decisions":["..."],'
            '"new_actions":[{"title":"...","org":"전략기획실|사업팀|연구소","due":"YYYY-MM-DD"}]}'
        )
        user_prompt = f"[기존 액션아이템]\n{open_actions_text}\n\n[이번 회의 메모]\n{raw_notes}"
        result = call_claude(system_prompt, user_prompt, max_tokens=800)
        if isinstance(result, str):
            try:
                cleaned = result.strip()
                if cleaned.startswith("```"):
                    cleaned = cleaned.strip("`")
                    cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned
                parsed = json.loads(cleaned)
                parsed["llmConnected"] = True
                return parsed
            except Exception:
                pass  # JSON 파싱 실패 시 폴백으로 이어짐

    # 규칙 기반 폴백: 메모에서 "결정:"/"신규:"/"지난주" 키워드로 대충 추출
    lines = [l.strip() for l in raw_notes.splitlines() if l.strip()]
    decisions = [l.split(":", 1)[-1].strip() for l in lines if l.startswith("결정")]
    new_actions_raw = [l.split(":", 1)[-1].strip() for l in lines if l.startswith("신규")]
    new_actions = [{"title": t, "org": "전략기획실", "due": ""} for t in new_actions_raw] or [
        {"title": "(메모에서 신규 액션아이템을 자동 추출하지 못했습니다 — 직접 입력해주세요)", "org": "", "due": ""}
    ]
    last_week_check = [{"title": a["title"], "status": a["status"]} for a in open_actions[:3]]

    return {
        "last_week_check": last_week_check,
        "decisions": decisions or ["(메모에서 결정사항을 자동 추출하지 못했습니다 — 직접 입력해주세요)"],
        "new_actions": new_actions,
        "llmConnected": False,
    }
