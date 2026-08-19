# -*- coding: utf-8 -*-
"""SQLite 스키마 정의 + 초기 시드 데이터.
PRD의 4대 관리표(진척률·이슈·산출물·회의록) + 액션아이템·알림·설정을 테이블로 구성한다.
서버 최초 기동 시 DB 파일이 없으면 자동으로 생성하고 시드 데이터를 채운다.
"""
import sqlite3
import os
import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "pmrag.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task TEXT NOT NULL,
    org TEXT NOT NULL,
    plan REAL NOT NULL,
    actual REAL NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    impact TEXT NOT NULL,
    urgency TEXT NOT NULL,
    org TEXT NOT NULL,
    status TEXT NOT NULL,
    due TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliverables (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    org TEXT NOT NULL,
    due TEXT,
    status TEXT NOT NULL,
    progress_pct REAL NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    org TEXT NOT NULL,
    due TEXT,
    status TEXT NOT NULL,      -- 미착수 / 진행중 / 완료
    source TEXT,               -- 어느 회의록/이슈에서 생성됐는지 표기
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS minutes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_date TEXT NOT NULL,
    attendees TEXT,
    raw_notes TEXT,
    last_week_check TEXT,   -- JSON
    decisions TEXT,          -- JSON
    new_actions TEXT,        -- JSON
    status TEXT NOT NULL,     -- draft / confirmed
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,     -- 긴급 / 지연 / 정보
    title TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_permissions (
    org TEXT PRIMARY KEY,
    can_view INTEGER NOT NULL,
    can_edit INTEGER NOT NULL,
    can_approve INTEGER NOT NULL
);
"""

def now():
    return datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def seed(conn):
    ts = now()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM progress")
    if cur.fetchone()[0] == 0:
        rows = [
            ("사업성 검토 보고서 작성", "사업팀", 80, 78),
            ("화면설계서(회원가입) 작성", "연구소", 70, 58),
            ("서비스 정책 초안 수립", "사업팀", 60, 61),
            ("DB 설계서 검토", "연구소", 75, 68),
            ("프로세스 설계서(결제) 작성", "전략기획실", 65, 64),
            ("퍼블리싱 화면(대시보드) 개발", "연구소", 55, 44),
            ("영업 제안서 초안", "사업팀", 90, 88),
            ("WBS 2차 일정 조정", "전략기획실", 100, 100),
        ]
        cur.executemany(
            "INSERT INTO progress(task, org, plan, actual, updated_at) VALUES (?,?,?,?,?)",
            [(t, o, p, a, ts) for t, o, p, a in rows],
        )

    cur.execute("SELECT COUNT(*) FROM issues")
    if cur.fetchone()[0] == 0:
        rows = [
            ("ISS-014", "인증서 연동 API 응답지연으로 발급 프로세스 중단 위험", "상", "상", "연구소", "진행중", "2026-08-20"),
            ("ISS-011", "정책 승인 지연에 따른 화면설계 일정 충돌", "상", "상", "사업팀", "진행중", "2026-08-19"),
            ("ISS-013", "DB 설계서 검토 인력 부족", "중", "상", "연구소", "진행중", "2026-08-22"),
            ("ISS-009", "결제 프로세스 정책 문구 재검토 요청", "중", "중", "사업팀", "등록", "2026-08-25"),
            ("ISS-007", "퍼블리싱 화면 반응형 이슈", "하", "중", "연구소", "해결", "2026-08-14"),
            ("ISS-005", "영업 제안서 산출물 버전 혼선", "하", "하", "사업팀", "종료", "2026-08-10"),
        ]
        cur.executemany(
            "INSERT INTO issues(id, content, impact, urgency, org, status, due, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            [(i, c, im, u, o, s, d, ts, ts) for i, c, im, u, o, s, d in rows],
        )

    cur.execute("SELECT COUNT(*) FROM deliverables")
    if cur.fetchone()[0] == 0:
        rows = [
            ("DOC-021", "화면설계서(결제)", "화면설계서", "연구소", "2026-08-24", "검토중", 64),
            ("DOC-019", "프로세스 설계서(가입심사)", "프로세스 설계서", "전략기획실", "2026-08-21", "작성중", 38),
            ("DOC-024", "DB 설계서 v2", "DB 설계서", "연구소", "2026-08-19", "지연", 72),
            ("DOC-018", "영업 제안서", "기타", "사업팀", "2026-08-17", "승인완료", 100),
            ("DOC-016", "서비스 정책 문서", "정책 문서", "사업팀", "2026-08-21", "검토중", 80),
            ("DOC-011", "WBS v3", "WBS", "전략기획실", "2026-08-12", "승인완료", 100),
        ]
        cur.executemany(
            "INSERT INTO deliverables(id, name, doc_type, org, due, status, progress_pct, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            [(i, n, t, o, d, s, p, ts) for i, n, t, o, d, s, p in rows],
        )

    cur.execute("SELECT COUNT(*) FROM actions")
    if cur.fetchone()[0] == 0:
        rows = [
            ("DB 설계 리소스 1명 추가 배정", "연구소", "2026-08-22", "미착수", "02_meeting_minutes #8/20"),
            ("정책 문서 재상정 자료 준비", "사업팀", "2026-08-21", "미착수", "02_meeting_minutes #8/20"),
            ("인증서 연동 API 임시 조치", "연구소", "2026-08-20", "진행중", "03_issue_log ISS-014"),
            ("화면설계서(결제) 1차 검토", "전략기획실", "2026-08-24", "진행중", "04_deliverables DOC-021"),
            ("사업성 검토 보고서 보완", "사업팀", "2026-08-25", "진행중", "01_progress"),
            ("화면설계서(회원가입) 수정", "연구소", "2026-08-18", "완료", "02_meeting_minutes #8/13"),
            ("영업 제안서 최종 승인", "사업팀", "2026-08-17", "완료", "04_deliverables DOC-018"),
        ]
        cur.executemany(
            "INSERT INTO actions(title, org, due, status, source, created_at) VALUES (?,?,?,?,?,?)",
            [(t, o, d, s, src, ts) for t, o, d, s, src in rows],
        )

    cur.execute("SELECT COUNT(*) FROM minutes")
    if cur.fetchone()[0] == 0:
        import json
        cur.execute(
            "INSERT INTO minutes(meeting_date, attendees, raw_notes, last_week_check, decisions, new_actions, status, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                "2026-08-13",
                "전략기획실·사업팀·연구소",
                "지난주 액션아이템 점검 완료. 화면설계서(회원가입) 수정 마무리, 영업 제안서 승인.",
                json.dumps([{"title": "1차 프로토타입 리뷰", "status": "완료"}], ensure_ascii=False),
                json.dumps(["회원가입 화면설계서 v2로 확정", "영업 제안서 최종 승인"], ensure_ascii=False),
                json.dumps([
                    {"title": "화면설계서(회원가입) 수정", "org": "연구소", "due": "2026-08-18"},
                    {"title": "영업 제안서 최종 승인", "org": "사업팀", "due": "2026-08-17"},
                ], ensure_ascii=False),
                "confirmed",
                ts,
            ),
        )

    cur.execute("SELECT COUNT(*) FROM notifications")
    if cur.fetchone()[0] == 0:
        rows = [
            ("긴급", "ISS-014 인증서 연동 API 응답지연", "영향도·긴급도 모두 '상' · 연구소 즉시 확인 필요"),
            ("긴급", "ISS-011 정책 승인 지연 → 일정 충돌", "사업팀 · 화면설계 일정에 영향"),
            ("지연", "DB 설계서 검토 TASK 지연 후보 감지", "계획 대비 -7%p · 연구소"),
            ("지연", "퍼블리싱 화면(대시보드) 지연 후보 감지", "계획 대비 -11%p · 연구소"),
            ("정보", "8월 2주차 주간회의 회의록 확정·배포", "전략기획실 · 전 조직 공유 완료"),
            ("정보", "산출물 DOC-018 영업 제안서 승인완료", "사업팀 · 최종 저장 및 버전 갱신"),
        ]
        cur.executemany(
            "INSERT INTO notifications(kind, title, detail, created_at) VALUES (?,?,?,?)",
            [(k, t, d, ts) for k, t, d in rows],
        )

    cur.execute("SELECT COUNT(*) FROM settings")
    if cur.fetchone()[0] == 0:
        defaults = [
            ("delay_threshold_pct", "5"),
            ("urgent_impact", "상"),
            ("urgent_urgency", "상"),
            ("notify_inapp", "1"),
            ("notify_email", "1"),
            ("notify_messenger", "0"),
        ]
        cur.executemany("INSERT INTO settings(key, value) VALUES (?,?)", defaults)

    cur.execute("SELECT COUNT(*) FROM org_permissions")
    if cur.fetchone()[0] == 0:
        rows = [
            ("전략기획실", 1, 1, 1),
            ("사업팀", 1, 1, 0),
            ("연구소", 1, 1, 0),
        ]
        cur.executemany(
            "INSERT INTO org_permissions(org, can_view, can_edit, can_approve) VALUES (?,?,?,?)",
            rows,
        )

    conn.commit()

def init_db():
    fresh = not os.path.exists(DB_PATH)
    conn = get_conn()
    conn.executescript(SCHEMA)
    seed(conn)
    conn.close()
    return fresh
