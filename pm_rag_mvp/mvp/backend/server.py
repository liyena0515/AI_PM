# -*- coding: utf-8 -*-
"""PM-RAG MVP 백엔드.
외부 웹 프레임워크 없이 파이썬 표준 라이브러리(http.server)만으로 구현한 REST API + 정적 파일 서버.
(fastapi 등 설치가 막힌 폐쇄망 환경에서도 그대로 실행되도록 하기 위한 선택.)

실행: python3 server.py  (기본 포트 8787)
"""
import json
import re
import os
import sys
import datetime
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(__file__))
import db
import rag

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
PORT = int(os.environ.get("PORT", "8787"))

STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/fonts_embed.css": ("fonts_embed.css", "text/css; charset=utf-8"),
}


def now():
    return db.now()


def get_setting(conn, key, default=None):
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key, value):
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, str(value)),
    )


def progress_with_status(conn):
    threshold = float(get_setting(conn, "delay_threshold_pct", "5"))
    out = []
    for row in conn.execute("SELECT * FROM progress ORDER BY id"):
        diff = row["actual"] - row["plan"]
        status = "지연" if diff <= -threshold else "정상"
        out.append({
            "id": row["id"], "task": row["task"], "org": row["org"],
            "plan": row["plan"], "actual": row["actual"], "diff": diff,
            "status": status, "updatedAt": row["updated_at"],
        })
    return out, threshold


def issue_dict(row):
    return {
        "id": row["id"], "content": row["content"], "impact": row["impact"],
        "urgency": row["urgency"], "org": row["org"], "status": row["status"],
        "due": row["due"], "createdAt": row["created_at"], "updatedAt": row["updated_at"],
    }


def deliverable_dict(row):
    return {
        "id": row["id"], "name": row["name"], "docType": row["doc_type"], "org": row["org"],
        "due": row["due"], "status": row["status"], "progressPct": row["progress_pct"],
        "updatedAt": row["updated_at"],
    }


def action_dict(row):
    return {
        "id": row["id"], "title": row["title"], "org": row["org"], "due": row["due"],
        "status": row["status"], "source": row["source"], "createdAt": row["created_at"],
    }


def notification_dict(row):
    return {"id": row["id"], "kind": row["kind"], "title": row["title"],
            "detail": row["detail"], "createdAt": row["created_at"]}


def add_notification(conn, kind, title, detail):
    conn.execute(
        "INSERT INTO notifications(kind, title, detail, created_at) VALUES (?,?,?,?)",
        (kind, title, detail, now()),
    )


def build_dashboard(conn):
    progress, threshold = progress_with_status(conn)
    delayed = [p for p in progress if p["status"] == "지연"]
    overall = round(sum(p["actual"] for p in progress) / len(progress), 1) if progress else 0
    plan_avg = round(sum(p["plan"] for p in progress) / len(progress), 1) if progress else 0

    org_breakdown = {}
    for p in progress:
        org_breakdown.setdefault(p["org"], []).append(p["actual"])
    org_avg = {o: round(sum(v) / len(v), 1) for o, v in org_breakdown.items()}

    issues = [issue_dict(r) for r in conn.execute("SELECT * FROM issues")]
    open_issues = [i for i in issues if i["status"] in ("등록", "진행중")]
    urgent_issues = [i for i in open_issues if i["impact"] == "상" and i["urgency"] == "상"]

    deliverables = [deliverable_dict(r) for r in conn.execute("SELECT * FROM deliverables")]
    approved = [d for d in deliverables if d["status"] == "승인완료"]
    approval_rate = round(len(approved) / len(deliverables) * 100) if deliverables else 0

    status_dist = {}
    for d in deliverables:
        status_dist[d["status"]] = status_dist.get(d["status"], 0) + 1

    notifications = [notification_dict(r) for r in conn.execute(
        "SELECT * FROM notifications ORDER BY id DESC LIMIT 6")]

    return {
        "overallProgress": overall,
        "planAverage": plan_avg,
        "delayedCount": len(delayed),
        "delayedTasks": delayed,
        "openIssueCount": len(open_issues),
        "urgentIssueCount": len(urgent_issues),
        "deliverableApprovalRate": approval_rate,
        "deliverableStatusDist": status_dist,
        "orgAverage": org_avg,
        "recentNotifications": notifications,
        "delayThreshold": threshold,
        "generatedAt": now(),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "PMRAG/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    # ---------- helpers ----------
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, filename, content_type):
        path = os.path.join(FRONTEND_DIR, filename)
        if not os.path.exists(path):
            self._send_json({"error": "not found"}, 404)
            return
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _route(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if method == "GET" and path in STATIC_FILES:
            fname, ctype = STATIC_FILES[path]
            self._send_static(fname, ctype)
            return
        if method == "OPTIONS":
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return

        if not path.startswith("/api/"):
            self._send_json({"error": "not found"}, 404)
            return

        conn = db.get_conn()
        try:
            body = self._read_json_body() if method in ("POST", "PATCH", "PUT") else {}
            result, status = self._dispatch_api(conn, method, path, query, body)
            self._send_json(result, status)
        except Exception as e:
            traceback.print_exc()
            self._send_json({"error": str(e)}, 500)
        finally:
            conn.close()

    # ---------- API dispatch ----------
    def _dispatch_api(self, conn, method, path, query, body):
        m = re.fullmatch(r"/api/([a-z]+)(?:/([^/]+))?(?:/([^/]+))?", path)
        if not m:
            return {"error": "unknown route"}, 404
        resource, id1, id2 = m.group(1), m.group(2), m.group(3)

        if resource == "health" and method == "GET":
            return {"ok": True, "llmConnected": rag.llm_connected(), "time": now()}, 200

        if resource == "dashboard" and method == "GET":
            return build_dashboard(conn), 200

        if resource == "report" and id1 == "weekly" and method == "GET":
            dash = build_dashboard(conn)
            dash["title"] = "주간 리포트"
            return dash, 200

        if resource == "progress":
            if method == "GET":
                items, threshold = progress_with_status(conn)
                return {"items": items, "delayThreshold": threshold}, 200
            if method == "PATCH" and id1:
                actual = float(body.get("actual"))
                row = conn.execute("SELECT * FROM progress WHERE id=?", (id1,)).fetchone()
                if not row:
                    return {"error": "not found"}, 404
                threshold = float(get_setting(conn, "delay_threshold_pct", "5"))
                was_delayed = (row["actual"] - row["plan"]) <= -threshold
                conn.execute("UPDATE progress SET actual=?, updated_at=? WHERE id=?", (actual, now(), id1))
                new_delayed = (actual - row["plan"]) <= -threshold
                if new_delayed and not was_delayed:
                    add_notification(conn, "지연", f"{row['task']} 지연 후보 자동 감지",
                                      f"계획 대비 {actual - row['plan']:+.0f}%p · {row['org']}")
                conn.commit()
                items, threshold = progress_with_status(conn)
                return {"items": items, "delayThreshold": threshold}, 200

        if resource == "issues":
            if method == "GET":
                return {"items": [issue_dict(r) for r in conn.execute("SELECT * FROM issues ORDER BY id DESC")]}, 200
            if method == "POST":
                existing_nums = []
                for r in conn.execute("SELECT id FROM issues"):
                    m = re.fullmatch(r"ISS-(\d+)", r["id"])
                    if m:
                        existing_nums.append(int(m.group(1)))
                new_id = f"ISS-{(max(existing_nums) + 1) if existing_nums else 1:03d}"
                conn.execute(
                    "INSERT INTO issues(id, content, impact, urgency, org, status, due, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?)",
                    (new_id, body.get("content", ""), body.get("impact", "중"), body.get("urgency", "중"),
                     body.get("org", "전략기획실"), "등록", body.get("due", ""), now(), now()),
                )
                if body.get("impact") == "상" and body.get("urgency") == "상":
                    add_notification(conn, "긴급", f"{new_id} {body.get('content','')[:30]}",
                                      f"영향도·긴급도 모두 '상' · {body.get('org','')} 즉시 확인 필요")
                conn.commit()
                return {"items": [issue_dict(r) for r in conn.execute("SELECT * FROM issues ORDER BY id DESC")]}, 201
            if method == "PATCH" and id1:
                conn.execute("UPDATE issues SET status=?, updated_at=? WHERE id=?",
                             (body.get("status"), now(), id1))
                conn.commit()
                return {"items": [issue_dict(r) for r in conn.execute("SELECT * FROM issues ORDER BY id DESC")]}, 200

        if resource == "deliverables":
            if method == "GET":
                return {"items": [deliverable_dict(r) for r in conn.execute("SELECT * FROM deliverables ORDER BY id")]}, 200
            if method == "PATCH" and id1:
                fields, params = [], []
                for k, col in (("status", "status"), ("progressPct", "progress_pct")):
                    if k in body:
                        fields.append(f"{col}=?")
                        params.append(body[k])
                if fields:
                    params += [now(), id1]
                    conn.execute(f"UPDATE deliverables SET {', '.join(fields)}, updated_at=? WHERE id=?", params)
                    conn.commit()
                return {"items": [deliverable_dict(r) for r in conn.execute("SELECT * FROM deliverables ORDER BY id")]}, 200

        if resource == "actions":
            if method == "GET":
                return {"items": [action_dict(r) for r in conn.execute("SELECT * FROM actions ORDER BY id DESC")]}, 200
            if method == "POST":
                conn.execute(
                    "INSERT INTO actions(title, org, due, status, source, created_at) VALUES (?,?,?,?,?,?)",
                    (body.get("title", ""), body.get("org", ""), body.get("due", ""), "미착수",
                     body.get("source", "수동 등록"), now()),
                )
                conn.commit()
                return {"items": [action_dict(r) for r in conn.execute("SELECT * FROM actions ORDER BY id DESC")]}, 201
            if method == "PATCH" and id1:
                conn.execute("UPDATE actions SET status=? WHERE id=?", (body.get("status"), id1))
                conn.commit()
                return {"items": [action_dict(r) for r in conn.execute("SELECT * FROM actions ORDER BY id DESC")]}, 200

        if resource == "minutes":
            if method == "GET":
                rows = conn.execute("SELECT * FROM minutes ORDER BY id DESC").fetchall()
                items = [{
                    "id": r["id"], "meetingDate": r["meeting_date"], "attendees": r["attendees"],
                    "decisions": json.loads(r["decisions"] or "[]"),
                    "newActions": json.loads(r["new_actions"] or "[]"), "status": r["status"],
                } for r in rows]
                return {"items": items}, 200
            if id1 == "draft" and method == "POST":
                open_actions = [action_dict(r) for r in conn.execute(
                    "SELECT * FROM actions WHERE status != '완료' ORDER BY id DESC LIMIT 5")]
                draft = rag.summarize_minutes(body.get("rawNotes", ""), open_actions)
                return draft, 200
            if id1 == "confirm" and method == "POST":
                decisions = body.get("decisions", [])
                new_actions = body.get("newActions", [])
                conn.execute(
                    "INSERT INTO minutes(meeting_date, attendees, raw_notes, last_week_check, decisions, new_actions, status, created_at) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (body.get("meetingDate", now()[:10]), body.get("attendees", ""), body.get("rawNotes", ""),
                     json.dumps(body.get("lastWeekCheck", []), ensure_ascii=False),
                     json.dumps(decisions, ensure_ascii=False),
                     json.dumps(new_actions, ensure_ascii=False), "confirmed", now()),
                )
                for a in new_actions:
                    conn.execute(
                        "INSERT INTO actions(title, org, due, status, source, created_at) VALUES (?,?,?,?,?,?)",
                        (a.get("title", ""), a.get("org", ""), a.get("due", ""), "미착수",
                         f"02_meeting_minutes #{body.get('meetingDate','')}", now()),
                    )
                add_notification(conn, "정보", "주간회의 회의록 확정·배포", "전략기획실 · 전 조직 공유 완료")
                conn.commit()
                return {"ok": True}, 201

        if resource == "notifications" and method == "GET":
            kind = query.get("kind", [None])[0]
            sql = "SELECT * FROM notifications"
            params = ()
            if kind:
                sql += " WHERE kind=?"
                params = (kind,)
            sql += " ORDER BY id DESC LIMIT 50"
            return {"items": [notification_dict(r) for r in conn.execute(sql, params)]}, 200

        if resource == "qna" and method == "POST":
            question = body.get("question", "").strip()
            if not question:
                return {"error": "question is required"}, 400
            return rag.answer_question(conn, question), 200

        if resource == "admin":
            if id1 == "settings":
                if method == "GET":
                    keys = ["delay_threshold_pct", "urgent_impact", "urgent_urgency",
                            "notify_inapp", "notify_email", "notify_messenger"]
                    return {k: get_setting(conn, k) for k in keys}, 200
                if method == "POST":
                    for k, v in body.items():
                        set_setting(conn, k, v)
                    conn.commit()
                    keys = ["delay_threshold_pct", "urgent_impact", "urgent_urgency",
                            "notify_inapp", "notify_email", "notify_messenger"]
                    return {k: get_setting(conn, k) for k in keys}, 200
            if id1 == "orgs":
                if method == "GET":
                    rows = conn.execute("SELECT * FROM org_permissions").fetchall()
                    return {"items": [dict(r) for r in rows]}, 200
                if method == "POST" and id2:
                    conn.execute(
                        "UPDATE org_permissions SET can_view=?, can_edit=?, can_approve=? WHERE org=?",
                        (int(body.get("canView", 1)), int(body.get("canEdit", 1)),
                         int(body.get("canApprove", 0)), id2),
                    )
                    conn.commit()
                    rows = conn.execute("SELECT * FROM org_permissions").fetchall()
                    return {"items": [dict(r) for r in rows]}, 200
            if id1 == "datasources" and method == "GET":
                tables = [
                    ("WBS / 01_progress.md", "progress"),
                    ("02_meeting_minutes.md", "minutes"),
                    ("03_issue_log.md", "issues"),
                    ("04_deliverables.md", "deliverables"),
                ]
                items = []
                for label, table in tables:
                    row = conn.execute(f"SELECT COUNT(*) c, MAX(updated_at) u FROM {table}"
                                        if table != "minutes" else
                                        f"SELECT COUNT(*) c, MAX(created_at) u FROM {table}").fetchone()
                    items.append({"label": label, "recordCount": row["c"], "lastSync": row["u"], "status": "정상"})
                return {"items": items}, 200

        return {"error": f"unhandled route {method} {path}"}, 404

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PATCH(self):
        self._route("PATCH")

    def do_OPTIONS(self):
        self._route("OPTIONS")


def main():
    fresh = db.init_db()
    print(f"[PM-RAG] DB ready ({'새로 생성' if fresh else '기존 사용'}): {db.DB_PATH}")
    print(f"[PM-RAG] LLM 연동: {'ON (Claude API)' if rag.llm_connected() else 'OFF (ANTHROPIC_API_KEY 미설정 — 폴백 모드)'}")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[PM-RAG] 서버 시작: http://localhost:{PORT}  (Ctrl+C로 종료)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[PM-RAG] 종료합니다.")


if __name__ == "__main__":
    main()
