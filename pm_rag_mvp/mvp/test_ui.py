# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright
import time

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=2)
    page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))

    page.goto("http://localhost:8787/", wait_until="networkidle")
    page.wait_for_timeout(400)
    page.screenshot(path="/tmp/mvp_00_dashboard.png", full_page=True)

    # 01 진척률: 실적 수정
    page.click('.nav-item[data-nav="01"]')
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/mvp_01_progress.png", full_page=True)
    inp = page.locator('input[data-action="update-progress"]').first
    inp.fill("30")
    inp.dispatch_event("change")
    page.wait_for_timeout(400)
    page.screenshot(path="/tmp/mvp_01_progress_after_edit.png", full_page=True)

    # 03 이슈 로그: 새 이슈 등록 모달
    page.click('.nav-item[data-nav="03"]')
    page.wait_for_timeout(300)
    page.click('[data-action="open-issue-modal"]')
    page.wait_for_timeout(200)
    page.fill('textarea[name="content"]', "Playwright 테스트로 등록한 이슈입니다")
    page.select_option('select[name="impact"]', "상")
    page.select_option('select[name="urgency"]', "상")
    page.select_option('select[name="org"]', "연구소")
    page.click('#issue-form button[type="submit"]')
    page.wait_for_timeout(500)
    page.screenshot(path="/tmp/mvp_03_issues_after_create.png", full_page=True)

    # 02 질의응답
    page.click('.nav-item[data-nav="02"]')
    page.wait_for_timeout(200)
    page.fill('#qna-input', "이번 주 지연 항목이랑 상급 이슈 모두 보여줘")
    page.click('#qna-form button[type="submit"]')
    page.wait_for_timeout(1200)
    page.screenshot(path="/tmp/mvp_02_qna.png", full_page=True)

    # 04 회의록 자동요약
    page.click('.nav-item[data-nav="04"]')
    page.wait_for_timeout(200)
    page.fill('#mm-notes', "지난주 액션아이템 점검 완료.\n결정: API 지연 건은 연구소가 금주 내 임시 조치\n신규: DB 설계 리소스 1명 추가 배정(연구소, 2026-08-22)")
    page.click('#mm-generate')
    page.wait_for_timeout(600)
    page.screenshot(path="/tmp/mvp_04_minutes_draft.png", full_page=True)
    if page.locator('#mm-confirm').count() > 0:
        page.click('#mm-confirm')
        page.wait_for_timeout(500)

    # 05 액션아이템
    page.click('.nav-item[data-nav="05"]')
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/mvp_05_actions.png", full_page=True)

    # 06 산출물
    page.click('.nav-item[data-nav="06"]')
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/mvp_06_deliverables.png", full_page=True)

    # 07 리포트
    page.click('.nav-item[data-nav="07"]')
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/mvp_07_report.png", full_page=True)

    # 08 알림센터
    page.click('.nav-item[data-nav="08"]')
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/mvp_08_alerts.png", full_page=True)

    # 09 관리자 설정: 임계값 변경
    page.click('.nav-item[data-nav="09"]')
    page.wait_for_timeout(300)
    page.evaluate("document.getElementById('threshold-range').value = 8; document.getElementById('threshold-range').dispatchEvent(new Event('input'))")
    page.click('#save-threshold')
    page.wait_for_timeout(400)
    page.screenshot(path="/tmp/mvp_09_admin.png", full_page=True)

    b.close()

print("CONSOLE/PAGE ERRORS:", errors)
print("DONE")
