// PM-RAG MVP 프론트엔드 — 프레임워크 없이 순수 JS로 백엔드 REST API를 호출해 렌더링한다.
(() => {
  "use strict";

  const NAV = [
    ["00", "대시보드", "MAIN DASHBOARD", "메인 대시보드", "4대 관리표(WBS·진척률·이슈·산출물) 종합 현황을 자동 취합합니다"],
    ["01", "진척률 관리", "PROGRESS TRACKING", "진척률 관리", "WBS 담당 TASK 진척률을 자동 집계하고 지연 후보를 실시간으로 감지합니다"],
    ["02", "질의응답", "RAG Q&A SEARCH", "질의응답", "4대 관리표를 검색해 근거(출처)와 함께 답변하는 자연어 질의응답입니다"],
    ["03", "이슈 로그", "ISSUE LOG", "이슈 로그 관리", "이슈 발생을 인지한 즉시 등록하고, 영향도·긴급도 기준으로 자동 우선순위를 판단합니다"],
    ["04", "회의록 자동요약", "MEETING MINUTES AI", "회의록 자동 요약", "회의 메모로부터 결정사항·액션아이템을 자동 구조화해 회의록 초안을 생성합니다"],
    ["05", "액션아이템", "ACTION ITEMS", "액션아이템 트래커", "회의에서 배정된 액션아이템을 담당 조직·기한 기준으로 칸반 보드로 추적합니다"],
    ["06", "산출물 관리", "DELIVERABLES BOARD", "산출물 관리", "WBS TASK 완료일정에 매핑된 산출물의 작성·검토·승인 상태를 관리합니다"],
    ["07", "주간 리포트", "WEEKLY REPORT", "주간 리포트", "화요일 오후 대시보드 취합을 자동화해 회의 자료로 바로 활용 가능한 리포트를 생성합니다"],
    ["08", "알림센터", "NOTIFICATION CENTER", "알림센터", "지연·긴급 이슈 자동 감지 결과와 주요 이벤트를 실시간으로 확인합니다"],
    ["09", "관리자 설정", "ADMIN SETTINGS", "관리자 설정", "지연 판정 임계값, 조직별 권한, 데이터 소스 연동을 관리합니다"],
  ];

  const $content = document.getElementById("content");
  let currentPage = "00";
  let llmConnected = false;
  const qnaHistory = []; // {role:'user'|'ai', text, sources}

  // ---------------- 유틸 ----------------
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function api(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
    return data;
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function orgTag(org) {
    const cls = { "전략기획실": "org-strat", "사업팀": "org-biz", "연구소": "org-lab" }[org] || "org-strat";
    return `<span class="org-tag ${cls}">${esc(org)}</span>`;
  }

  function levelPill(v) {
    const m = { "상": "pill-orange", "중": "pill-yellow", "하": "pill-gray" };
    return `<span class="pill ${m[v] || "pill-gray"}">${esc(v)}</span>`;
  }

  function openModal(html) {
    const root = document.getElementById("modal-root");
    root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal">${html}</div></div>`;
    root.querySelector("#modal-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") closeModal();
    });
  }
  function closeModal() { document.getElementById("modal-root").innerHTML = ""; }
  window.closeModal = closeModal;

  // ---------------- 헤더/사이드바 ----------------
  function renderNav() {
    const nav = document.getElementById("nav");
    nav.innerHTML = NAV.map(([num, label]) =>
      `<button class="nav-item${num === currentPage ? " active" : ""}" data-nav="${num}">
        <span class="nav-num">${num}</span>${esc(label)}
      </button>`
    ).join("");
  }

  function updateHeader(num) {
    const meta = NAV.find((n) => n[0] === num);
    if (!meta) return;
    document.getElementById("crumb-current").textContent = meta[1];
    document.getElementById("banner-eyebrow").textContent = meta[2];
    document.getElementById("banner-title").textContent = meta[3];
    document.getElementById("banner-desc").textContent = meta[4];
    document.getElementById("footer-pagename").textContent = meta[1];
    document.title = `PM-RAG · ${meta[1]}`;
  }

  async function refreshBell() {
    try {
      const { items } = await api("GET", "/api/notifications");
      const unread = items.filter((n) => n.kind !== "정보").length;
      document.getElementById("bell-badge").textContent = unread;
    } catch { /* noop */ }
  }

  async function checkHealth() {
    const strip = document.getElementById("proto-strip");
    const dot = document.getElementById("status-dot");
    try {
      const h = await api("GET", "/api/health");
      llmConnected = h.llmConnected;
      if (llmConnected) {
        strip.textContent = "● LIVE MODE · Claude API 연동됨 — 질의응답·회의록 요약이 실제 LLM으로 생성됩니다";
        strip.classList.add("ok");
        dot.textContent = "RAG Engine Connected · Claude API ON";
        dot.classList.remove("off");
      } else {
        strip.textContent = "● FALLBACK MODE · ANTHROPIC_API_KEY 미설정 — 검색 결과 기반 폴백 답변으로 동작 중";
        dot.textContent = "RAG Engine · 폴백 모드 (API 키 미설정)";
        dot.classList.add("off");
      }
    } catch {
      strip.textContent = "● 서버에 연결할 수 없습니다. backend/server.py가 실행 중인지 확인해주세요.";
      dot.textContent = "서버 연결 끊김";
      dot.classList.add("off");
    }
  }

  function switchPage(num) {
    currentPage = num;
    renderNav();
    updateHeader(num);
    $content.innerHTML = `<div class="empty-state">불러오는 중…</div>`;
    const fn = RENDERERS[num];
    if (fn) fn().catch((e) => {
      $content.innerHTML = `<div class="empty-state">오류: ${esc(e.message)}</div>`;
    });
    window.scrollTo(0, 0);
  }
  window.switchPage = switchPage;

  // ================= 00 대시보드 =================
  async function renderDashboard() {
    const d = await api("GET", "/api/dashboard");
    const dist = d.deliverableStatusDist || {};
    const distTotal = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
    const distColors = { "승인완료": "var(--blue)", "검토중": "var(--tint-blue)", "작성중": "#e3e3e3", "지연": "var(--orange)" };
    const distBar = Object.entries(dist).map(([k, v]) =>
      `<div style="width:${(v / distTotal * 100).toFixed(1)}%; background:${distColors[k] || "#ccc"};"></div>`).join("");
    const distLegend = Object.entries(dist).map(([k, v]) =>
      `<span>&#9679; ${esc(k)} ${Math.round(v / distTotal * 100)}%</span>`).join("");

    const orgRows = Object.entries(d.orgAverage || {}).map(([org, avg]) => `
      <div>
        <div style="display:flex; justify-content:space-between; font-size:12.5px; font-family:var(--font-bold); font-weight:700; color:var(--text-1); margin-bottom:6px;">
          <span>${orgTag(org)} </span><span>${avg}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill${avg < 75 ? " orange" : ""}" style="width:${avg}%"></div></div>
      </div>`).join("<div style='height:16px'></div>");

    const notifRows = (d.recentNotifications || []).map((n) => `
      <div style="padding:14px 20px; border-bottom:1px solid var(--line); display:flex; gap:12px; align-items:flex-start;">
        <span class="alert-dot" style="margin-top:5px; background:${n.kind === "긴급" ? "var(--orange)" : n.kind === "지연" ? "var(--yellow)" : "var(--blue)"};"></span>
        <div><b style="font-size:12.5px; color:var(--text-1);">${esc(n.title)}</b>
          <div style="font-size:11.5px; color:var(--text-3); margin-top:2px;">${esc(n.detail || "")}</div></div>
      </div>`).join("") || `<div class="empty-state">알림이 없습니다</div>`;

    $content.innerHTML = `
      <div class="grid g4">
        <div class="card">
          <div class="card-title">종합 진척률</div><div class="card-sub">계획 대비 실적 · 전 조직 평균</div>
          <div class="kpi-num">${d.overallProgress}<small>%</small></div>
          <div class="bar-track"><div class="bar-fill" style="width:${d.overallProgress}%"></div></div>
          <div class="kpi-delta ${d.overallProgress >= d.planAverage ? "up" : "warn"}">계획 대비 ${(d.overallProgress - d.planAverage).toFixed(1)}%p</div>
        </div>
        <div class="card">
          <div class="card-title">지연 TASK</div><div class="card-sub">계획 대비 실적 ${d.delayThreshold}%p 초과</div>
          <div class="kpi-num" style="color:${d.delayedCount ? "#C43E00" : "inherit"}">${d.delayedCount}<small>건</small></div>
        </div>
        <div class="card">
          <div class="card-title">열린 이슈</div><div class="card-sub">긴급 이슈 ${d.urgentIssueCount}건 포함</div>
          <div class="kpi-num">${d.openIssueCount}<small>건</small></div>
        </div>
        <div class="card">
          <div class="card-title">산출물 승인률</div><div class="card-sub">승인완료 기준</div>
          <div class="kpi-num">${d.deliverableApprovalRate}<small>%</small></div>
          <div class="bar-track"><div class="bar-fill" style="width:${d.deliverableApprovalRate}%"></div></div>
        </div>
      </div>

      <div class="section-title">조직별 진척률<button class="more" data-goto="01">01 진척률 관리 →</button></div>
      <div class="card">${orgRows || `<div class="empty-state">데이터 없음</div>`}</div>

      <div class="grid g2" style="margin-top:22px;">
        <div>
          <div class="section-title">최근 알림<button class="more" data-goto="08">08 알림센터 →</button></div>
          <div class="card" style="padding:0;">${notifRows}</div>
        </div>
        <div>
          <div class="section-title">산출물 상태 분포<button class="more" data-goto="06">06 산출물 관리 →</button></div>
          <div class="card">
            <div style="display:flex; height:14px; border-radius:7px; overflow:hidden;">${distBar}</div>
            <div style="display:flex; gap:16px; margin-top:10px; font-size:11px; color:var(--text-2); flex-wrap:wrap;">${distLegend}</div>
          </div>
        </div>
      </div>`;
  }

  // ================= 01 진척률 관리 =================
  let progressFilterOrg = "전체", progressFilterStatus = "전체";
  async function renderProgress() {
    const { items, delayThreshold } = await api("GET", "/api/progress");
    const filtered = items.filter((p) =>
      (progressFilterOrg === "전체" || p.org === progressFilterOrg) &&
      (progressFilterStatus === "전체" || p.status === progressFilterStatus));
    const delayedCount = items.filter((p) => p.status === "지연").length;

    const rows = filtered.map((p) => `
      <tr>
        <td style="font-family:var(--font-bold); font-weight:700; color:var(--text-1);">${esc(p.task)}</td>
        <td>${orgTag(p.org)}</td>
        <td>${p.plan}%</td>
        <td><input type="number" class="input" style="width:76px; padding:6px 8px;" min="0" max="100"
              data-action="update-progress" data-id="${p.id}" value="${p.actual}"></td>
        <td style="font-family:var(--font-bold); font-weight:700; color:${p.diff <= -delayThreshold ? "#C43E00" : "var(--text-2)"}">${p.diff > 0 ? "+" : ""}${p.diff.toFixed(0)}%p</td>
        <td><span class="pill ${p.status === "지연" ? "pill-orange" : "pill-blue"}">&#9679; ${p.status}</span></td>
        <td style="min-width:110px;"><div class="bar-track"><div class="bar-fill${p.status === "지연" ? " orange" : ""}" style="width:${p.actual}%"></div></div></td>
      </tr>`).join("") || `<tr><td colspan="7" class="empty-state">해당 조건의 TASK가 없습니다</td></tr>`;

    const orgChip = (v) => `<button class="chip ${progressFilterOrg === v ? "active" : ""}" data-action="progress-filter-org" data-value="${v}">${v}</button>`;
    const statusChip = (v) => `<button class="chip ${progressFilterStatus === v ? "active" : ""}" data-action="progress-filter-status" data-value="${v}">${v}</button>`;

    $content.innerHTML = `
      <div class="alert-strip">
        <span class="alert-dot"></span>
        <div style="font-size:12.5px; color:#8a4700;">계획 대비 실적 차이가 <b>${delayThreshold}%p</b>를 초과한 TASK <b>${delayedCount}건</b>이 지연 후보로 자동 감지되었습니다. 실적(%) 값을 직접 수정해보세요 — 즉시 재계산됩니다.</div>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap;">
        ${orgChip("전체")}${orgChip("전략기획실")}${orgChip("사업팀")}${orgChip("연구소")}
        <span style="margin-left:auto"></span>
        ${statusChip("전체")}${statusChip("정상")}${statusChip("지연")}
      </div>
      <div class="card" style="padding:0; overflow:hidden;">
        <table>
          <thead><tr><th>WBS TASK</th><th>담당 조직</th><th>계획(%)</th><th>실적(%)</th><th>차이</th><th>상태</th><th>진행률</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="font-size:11px; color:var(--text-3); margin-top:10px;">* 지연 판정 기준: 계획 대비 실적 차이 ${delayThreshold}%p 초과 (09 관리자 설정에서 조정 가능)</div>`;
  }

  // ================= 02 질의응답 =================
  const QUICK_PROMPTS = ["이번 주 지연 항목은?", "상 등급 이슈 보여줘", "산출물 승인 현황"];
  async function renderQna() {
    $content.innerHTML = `
      <div style="display:grid; grid-template-columns:260px 1fr; gap:20px;">
        <div>
          <div class="card-title" style="margin-bottom:10px;">최근 질문</div>
          <div class="card" style="padding:8px;" id="qna-history-list"></div>
        </div>
        <div>
          <div class="card" style="min-height:520px; display:flex; flex-direction:column; padding:24px;">
            <div style="flex:1;" id="qna-thread"></div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin:14px 0;" id="qna-prompts">
              ${QUICK_PROMPTS.map((q) => `<button class="chip" data-action="qna-quick" data-q="${esc(q)}">${esc(q)}</button>`).join("")}
            </div>
            <form id="qna-form" style="display:flex; gap:10px; border:1px solid var(--line-strong); border-radius:26px; padding:6px 8px 6px 20px; align-items:center;">
              <input class="input" id="qna-input" style="border:none; flex:1; padding:8px 0;" placeholder="4대 관리표에 대해 무엇이든 물어보세요…" autocomplete="off">
              <button class="btn btn-primary" type="submit">전송</button>
            </form>
          </div>
        </div>
      </div>`;
    renderQnaThread();
    document.getElementById("qna-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("qna-input");
      const q = input.value.trim();
      if (!q) return;
      input.value = "";
      askQuestion(q);
    });
  }

  function renderQnaThread() {
    const thread = document.getElementById("qna-thread");
    if (!thread) return;
    thread.innerHTML = qnaHistory.map((m) => {
      if (m.role === "user") {
        return `<div style="display:flex; justify-content:flex-end; margin-bottom:18px;">
          <div style="background:var(--navy); color:#fff; padding:12px 18px; border-radius:14px 14px 2px 14px; font-size:13px; max-width:70%;">${esc(m.text)}</div>
        </div>`;
      }
      const chips = (m.sources || []).map((s) => `<span class="chip" style="font-size:10.5px; padding:4px 10px; cursor:default;">출처: ${esc(s.source)} · ${esc(s.date)}</span>`).join("");
      const bodyText = m.loading ? "생각하는 중…" : esc(m.text).trim();
      const chipsHtml = chips ? `<div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">${chips}</div>` : "";
      const bubbleInner = `<span style="white-space:pre-wrap;">${bodyText}</span>${chipsHtml}`;
      return `<div style="display:flex; gap:12px; margin-bottom:18px;">
        <div class="brand-mark" style="width:28px; height:28px; flex-shrink:0;"><span style="width:15px;height:15px;"></span><span style="width:15px;height:15px; top:6px; left:13px;"></span><span style="width:15px;height:15px; top:13px; left:6px;"></span><span style="width:15px;height:15px; top:6px; left:0;"></span></div>
        <div style="background:#F7F9FF; border:1px solid var(--tint-blue); padding:14px 18px; border-radius:2px 14px 14px 14px; font-size:13px; color:var(--text-2); max-width:78%;">${bubbleInner}</div>
      </div>`;
    }).join("") || `<div class="empty-state">궁금한 점을 물어보세요. 예: "이번 주 지연 항목이랑 상급 이슈 모두 보여줘"</div>`;

    const list = document.getElementById("qna-history-list");
    if (list) {
      const userMsgs = qnaHistory.filter((m) => m.role === "user").slice(-8).reverse();
      list.innerHTML = userMsgs.map((m, i) =>
        `<div style="padding:11px 12px; border-radius:8px; ${i === 0 ? "background:var(--tint-blue); font-family:var(--font-bold); font-weight:700; color:var(--navy);" : "color:var(--text-2);"} font-size:12px; margin-bottom:4px; cursor:pointer;" data-action="qna-quick" data-q="${esc(m.text)}">${esc(m.text)}</div>`
      ).join("") || `<div style="padding:11px 12px; color:var(--text-3); font-size:12px;">아직 질문이 없습니다</div>`;
    }
  }

  async function askQuestion(q) {
    qnaHistory.push({ role: "user", text: q });
    qnaHistory.push({ role: "ai", text: "", loading: true });
    renderQnaThread();
    try {
      const res = await api("POST", "/api/qna", { question: q });
      const last = qnaHistory[qnaHistory.length - 1];
      last.loading = false;
      last.text = res.answer;
      last.sources = res.sources;
    } catch (e) {
      const last = qnaHistory[qnaHistory.length - 1];
      last.loading = false;
      last.text = "오류가 발생했습니다: " + e.message;
    }
    renderQnaThread();
  }

  // ================= 03 이슈 로그 =================
  let issueFilter = "전체";
  async function renderIssues() {
    const { items } = await api("GET", "/api/issues");
    const urgentCount = items.filter((i) => i.impact === "상" && i.urgency === "상" && (i.status === "등록" || i.status === "진행중")).length;
    let filtered = items;
    if (issueFilter === "긴급") filtered = items.filter((i) => i.impact === "상" && i.urgency === "상");
    if (issueFilter === "진행중") filtered = items.filter((i) => i.status === "진행중" || i.status === "등록");
    if (issueFilter === "해결·종료") filtered = items.filter((i) => i.status === "해결" || i.status === "종료");

    const statusOptions = ["등록", "진행중", "해결", "종료"];
    const rows = filtered.map((i) => `
      <tr style="${i.impact === "상" && i.urgency === "상" ? "background:#FFF6F0;" : ""}">
        <td style="font-family:var(--font-bold); font-weight:700; color:var(--text-1);">${esc(i.id)}</td>
        <td style="max-width:340px;">${esc(i.content)}</td>
        <td>${levelPill(i.impact)}</td>
        <td>${levelPill(i.urgency)}</td>
        <td>${orgTag(i.org)}</td>
        <td><select class="input" style="padding:6px 8px; width:100px;" data-action="update-issue-status" data-id="${i.id}">
          ${statusOptions.map((s) => `<option value="${s}" ${s === i.status ? "selected" : ""}>${s}</option>`).join("")}
        </select></td>
        <td>${esc(i.due || "-")}</td>
      </tr>`).join("") || `<tr><td colspan="7" class="empty-state">해당 조건의 이슈가 없습니다</td></tr>`;

    $content.innerHTML = `
      <div class="alert-strip">
        <span class="alert-dot"></span>
        <div style="font-size:12.5px; color:#8a4700;"><b>영향도·긴급도 모두 '상'</b>인 이슈 <b>${urgentCount}건</b>이 즉시 확인이 필요합니다.</div>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:16px;">
        ${["전체", "긴급", "진행중", "해결·종료"].map((v) => `<button class="chip ${issueFilter === v ? "active" : ""}" data-action="issue-filter" data-value="${v}">${v}</button>`).join("")}
        <span style="margin-left:auto"></span>
        <button class="btn btn-primary" data-action="open-issue-modal">+ 이슈 등록</button>
      </div>
      <div class="card" style="padding:0; overflow:hidden;">
        <table><thead><tr><th>이슈ID</th><th>내용</th><th>영향도</th><th>긴급도</th><th>담당 조직</th><th>상태</th><th>목표 해결일</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>`;
  }

  function openIssueModal() {
    openModal(`
      <h3>새 이슈 등록</h3>
      <form id="issue-form">
        <div class="field"><label>내용</label><textarea class="textarea" name="content" required placeholder="이슈 내용을 입력하세요"></textarea></div>
        <div class="grid g2">
          <div class="field"><label>영향도</label><select class="input" name="impact"><option>상</option><option>중</option><option selected>하</option></select></div>
          <div class="field"><label>긴급도</label><select class="input" name="urgency"><option>상</option><option>중</option><option selected>하</option></select></div>
        </div>
        <div class="grid g2">
          <div class="field"><label>담당 조직</label><select class="input" name="org"><option>전략기획실</option><option>사업팀</option><option>연구소</option></select></div>
          <div class="field"><label>목표 해결일</label><input class="input" type="date" name="due"></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">취소</button>
          <button type="submit" class="btn btn-primary">등록</button>
        </div>
      </form>`);
    document.getElementById("issue-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = Object.fromEntries(f.entries());
      try {
        await api("POST", "/api/issues", body);
        closeModal();
        toast("이슈가 등록되었습니다");
        if (body.impact === "상" && body.urgency === "상") toast("긴급 이슈로 분류되어 알림이 발송되었습니다");
        refreshBell();
        renderIssues();
      } catch (err) { toast("오류: " + err.message); }
    });
  }

  // ================= 04 회의록 자동요약 =================
  let currentDraft = null;
  async function renderMinutes() {
    $content.innerHTML = `
      <div class="grid g2">
        <div>
          <div class="section-title">회의 메모 입력</div>
          <div class="card">
            <div class="grid g2" style="margin-bottom:12px;">
              <div class="field"><label>회의 일자</label><input class="input" type="date" id="mm-date" value="${new Date().toISOString().slice(0,10)}"></div>
              <div class="field"><label>참석 조직</label><input class="input" id="mm-attendees" value="전략기획실·사업팀·연구소"></div>
            </div>
            <div class="field"><label>메모 (자유 형식 — "결정:", "신규:"로 시작하는 줄은 폴백 모드에서 자동 인식됩니다)</label>
              <textarea class="textarea" id="mm-notes" style="min-height:220px;" placeholder="예)
지난주 액션아이템 점검 완료.
결정: API 지연 건은 연구소가 금주 내 임시 조치
결정: 정책 승인은 사업팀이 목요일까지 재상정
신규: DB 설계 리소스 1명 추가 배정(연구소, 8/22)
신규: 정책 문서 재상정(사업팀, 8/21)"></textarea>
            </div>
            <button class="btn btn-primary" id="mm-generate">AI 초안 생성</button>
          </div>
        </div>
        <div>
          <div class="section-title">AI 자동 생성 초안<span class="badge-ai ${llmConnected ? "" : "off"}" style="margin-left:auto;">${llmConnected ? "AI 생성" : "폴백 모드"}</span></div>
          <div class="card" id="mm-draft-area"><div class="empty-state">왼쪽에 메모를 입력하고 "AI 초안 생성"을 눌러주세요</div></div>
        </div>
      </div>`;
    document.getElementById("mm-generate").addEventListener("click", generateMinutesDraft);
  }

  async function generateMinutesDraft() {
    const notes = document.getElementById("mm-notes").value.trim();
    if (!notes) { toast("메모를 입력해주세요"); return; }
    const area = document.getElementById("mm-draft-area");
    area.innerHTML = `<div class="empty-state">AI가 초안을 생성하는 중…</div>`;
    try {
      const draft = await api("POST", "/api/minutes/draft", { rawNotes: notes });
      currentDraft = draft;
      renderDraft(draft);
    } catch (e) {
      area.innerHTML = `<div class="empty-state">오류: ${esc(e.message)}</div>`;
    }
  }

  function renderDraft(draft) {
    const area = document.getElementById("mm-draft-area");
    const checkRows = (draft.last_week_check || []).map((c) =>
      `<tr><td style="padding:6px 0; font-size:12px;">${esc(c.title)}</td><td style="text-align:right;"><span class="pill ${c.status === "완료" ? "pill-blue" : c.status === "진행중" ? "pill-yellow" : "pill-orange"}">${esc(c.status)}</span></td></tr>`
    ).join("") || `<tr><td class="empty-state" colspan="2">없음</td></tr>`;
    const decisions = draft.decisions || [];
    const actions = draft.new_actions || [];

    area.innerHTML = `
      <div style="font-size:12px; font-family:var(--font-bold); font-weight:700; color:var(--text-1); margin-bottom:8px;">1. 지난주 액션아이템 점검</div>
      <table style="margin-bottom:16px;"><tbody>${checkRows}</tbody></table>
      <div style="font-size:12px; font-family:var(--font-bold); font-weight:700; color:var(--text-1); margin-bottom:8px;">2. 결정사항</div>
      <ul style="font-size:12px; color:var(--text-2); padding-left:18px; margin-bottom:16px;">
        ${decisions.map((d) => `<li>${esc(d)}</li>`).join("") || "<li>없음</li>"}
      </ul>
      <div style="font-size:12px; font-family:var(--font-bold); font-weight:700; color:var(--text-1); margin-bottom:8px;">3. 신규 액션아이템</div>
      <table>
        <thead><tr><th style="font-size:10.5px;">내용</th><th style="font-size:10.5px;">담당</th><th style="font-size:10.5px;">기한</th></tr></thead>
        <tbody>${actions.map((a) => `<tr><td style="font-size:12px;">${esc(a.title)}</td><td>${orgTag(a.org || "전략기획실")}</td><td style="font-size:12px;">${esc(a.due || "-")}</td></tr>`).join("") || `<tr><td colspan="3" class="empty-state">없음</td></tr>`}</tbody>
      </table>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:18px;">
        <button class="btn btn-ghost" id="mm-regenerate">초안 다시 생성</button>
        <button class="btn btn-primary" id="mm-confirm">검토 후 확정 및 배포</button>
      </div>`;
    document.getElementById("mm-regenerate").addEventListener("click", generateMinutesDraft);
    document.getElementById("mm-confirm").addEventListener("click", confirmMinutes);
  }

  async function confirmMinutes() {
    if (!currentDraft) return;
    const body = {
      meetingDate: document.getElementById("mm-date").value,
      attendees: document.getElementById("mm-attendees").value,
      rawNotes: document.getElementById("mm-notes").value,
      lastWeekCheck: currentDraft.last_week_check || [],
      decisions: currentDraft.decisions || [],
      newActions: currentDraft.new_actions || [],
    };
    try {
      await api("POST", "/api/minutes/confirm", body);
      toast("회의록이 확정·배포되었습니다. 액션아이템에 반영되었습니다.");
      refreshBell();
      switchPage("05");
    } catch (e) { toast("오류: " + e.message); }
  }

  // ================= 05 액션아이템 =================
  async function renderActions() {
    const { items } = await api("GET", "/api/actions");
    const cols = { "미착수": [], "진행중": [], "완료": [] };
    items.forEach((a) => (cols[a.status] || cols["미착수"]).push(a));

    const statusOptions = ["미착수", "진행중", "완료"];
    const card = (a) => `
      <div class="kanban-card">
        <div class="title">${esc(a.title)}</div>
        <div class="meta">
          ${orgTag(a.org)}<span>${esc(a.due || "-")}</span>
        </div>
        <div style="margin-top:8px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:10px; color:var(--text-3);">${esc(a.source || "")}</span>
          <select class="input" style="padding:4px 6px; width:88px; font-size:11px;" data-action="update-action-status" data-id="${a.id}">
            ${statusOptions.map((s) => `<option value="${s}" ${s === a.status ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </div>
      </div>`;

    $content.innerHTML = `
      <div style="display:flex; justify-content:flex-end; margin-bottom:16px;">
        <button class="btn btn-primary" data-action="open-action-modal">+ 액션아이템 추가</button>
      </div>
      <div class="grid g3">
        <div>
          <div class="section-title" style="border-color:#9a9a9a;">미착수 <span class="pill pill-gray" style="margin-left:6px;">${cols["미착수"].length}</span></div>
          <div class="kanban-col">${cols["미착수"].map(card).join("") || `<div class="empty-state">없음</div>`}</div>
        </div>
        <div>
          <div class="section-title">진행중 <span class="pill pill-blue" style="margin-left:6px;">${cols["진행중"].length}</span></div>
          <div class="kanban-col">${cols["진행중"].map(card).join("") || `<div class="empty-state">없음</div>`}</div>
        </div>
        <div>
          <div class="section-title">완료 <span class="pill pill-navy" style="margin-left:6px;">${cols["완료"].length}</span></div>
          <div class="kanban-col">${cols["완료"].map(card).join("") || `<div class="empty-state">없음</div>`}</div>
        </div>
      </div>`;
  }

  function openActionModal() {
    openModal(`
      <h3>액션아이템 추가</h3>
      <form id="action-form">
        <div class="field"><label>내용</label><input class="input" name="title" required></div>
        <div class="grid g2">
          <div class="field"><label>담당 조직</label><select class="input" name="org"><option>전략기획실</option><option>사업팀</option><option>연구소</option></select></div>
          <div class="field"><label>기한</label><input class="input" type="date" name="due"></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">취소</button>
          <button type="submit" class="btn btn-primary">추가</button>
        </div>
      </form>`);
    document.getElementById("action-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      body.source = "수동 등록";
      try {
        await api("POST", "/api/actions", body);
        closeModal();
        toast("액션아이템이 추가되었습니다");
        renderActions();
      } catch (err) { toast("오류: " + err.message); }
    });
  }

  // ================= 06 산출물 관리 =================
  async function renderDeliverables() {
    const { items } = await api("GET", "/api/deliverables");
    const counts = {};
    items.forEach((d) => (counts[d.status] = (counts[d.status] || 0) + 1));
    const statusOptions = ["작성중", "검토중", "승인완료", "지연"];
    const statusPill = { "작성중": "pill-gray", "검토중": "pill-yellow", "승인완료": "pill-blue", "지연": "pill-orange" };

    const rows = items.map((d) => `
      <tr>
        <td style="font-family:var(--font-bold); font-weight:700; color:var(--text-1);">${esc(d.id)}</td>
        <td style="font-family:var(--font-bold); font-weight:700;">${esc(d.name)}</td>
        <td><span class="pill pill-navy">${esc(d.docType)}</span></td>
        <td>${orgTag(d.org)}</td>
        <td>${esc(d.due || "-")}</td>
        <td><select class="input" style="padding:6px 8px; width:104px;" data-action="update-deliverable-status" data-id="${d.id}">
          ${statusOptions.map((s) => `<option value="${s}" ${s === d.status ? "selected" : ""}>${s}</option>`).join("")}
        </select></td>
        <td style="min-width:110px;"><div class="bar-track"><div class="bar-fill${d.status === "지연" ? " orange" : ""}" style="width:${d.progressPct}%"></div></div></td>
      </tr>`).join("");

    $content.innerHTML = `
      <div class="grid g4" style="margin-bottom:22px;">
        ${statusOptions.map((s) => `<div class="card"><div class="card-title">${s}</div><div class="kpi-num" style="${s === "지연" ? "color:#C43E00" : s === "승인완료" ? "color:var(--blue)" : ""}">${counts[s] || 0}<small>건</small></div></div>`).join("")}
      </div>
      <div class="section-title">산출물 목록<span class="more">WBS 완료 일정에 자동 매핑</span></div>
      <div class="card" style="padding:0; overflow:hidden;">
        <table><thead><tr><th>문서ID</th><th>문서명</th><th>유형</th><th>담당 조직</th><th>목표일</th><th>상태</th><th>진행률</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>`;
  }

  // ================= 07 주간 리포트 =================
  async function renderReport() {
    const d = await api("GET", "/api/report/weekly");
    const dist = d.deliverableStatusDist || {};
    const distTotal = Object.values(dist).reduce((a, b) => a + b, 0) || 1;
    const distColors = { "승인완료": "var(--blue)", "검토중": "var(--tint-blue)", "작성중": "#e3e3e3", "지연": "var(--orange)" };
    const distBar = Object.entries(dist).map(([k, v]) => `<div style="width:${(v / distTotal * 100).toFixed(1)}%; background:${distColors[k] || "#ccc"};"></div>`).join("");
    const distLegend = Object.entries(dist).map(([k, v]) => `<span>&#9679; ${esc(k)} ${Math.round(v / distTotal * 100)}%</span>`).join("");
    const delayedRows = (d.delayedTasks || []).map((t) => `<tr><td>${esc(t.task)}</td><td>${orgTag(t.org)}</td><td style="color:#C43E00; font-weight:700;">${t.diff.toFixed(0)}%p</td></tr>`).join("") || `<tr><td colspan="3" class="empty-state">지연 항목 없음</td></tr>`;

    $content.innerHTML = `
      <div class="card" style="background:linear-gradient(135deg,var(--grad1),var(--grad3)); border:none; color:#fff; display:flex; align-items:center; gap:26px; margin-bottom:22px; flex-wrap:wrap;">
        <div class="circle-badge"><div class="num">${d.overallProgress}</div><div class="unit">%</div></div>
        <div>
          <div style="font-size:11px; letter-spacing:1.5px; opacity:0.85; font-family:var(--font-bold); font-weight:700;">WEEKLY REPORT</div>
          <div style="font-size:22px; font-family:var(--font-title); margin-top:6px;">종합 진척률 ${d.overallProgress}%</div>
          <div style="font-size:12px; opacity:0.9; margin-top:6px;">실시간 데이터 기준 자동 생성 · 생성일시 ${esc(d.generatedAt)}</div>
        </div>
        <div style="margin-left:auto; display:flex; gap:10px;">
          <button class="chip" style="background:rgba(255,255,255,0.15); color:#fff; border-color:rgba(255,255,255,0.4);" onclick="window.print()">PDF 다운로드</button>
          <button class="chip" style="background:rgba(255,255,255,0.15); color:#fff; border-color:rgba(255,255,255,0.4);" data-action="copy-link">공유 링크 복사</button>
        </div>
      </div>
      <div class="grid g2">
        <div>
          <div class="section-title">지연 항목 (${(d.delayedTasks || []).length}건)</div>
          <div class="card"><table><thead><tr><th>TASK</th><th>담당</th><th>차이</th></tr></thead><tbody>${delayedRows}</tbody></table></div>
        </div>
        <div>
          <div class="section-title">이슈 요약</div>
          <div class="card">
            <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:10px;"><span>긴급(상·상)</span><b style="color:#C43E00;">${d.urgentIssueCount}건</b></div>
            <div style="display:flex; justify-content:space-between; font-size:12.5px;"><span>열린 이슈</span><b>${d.openIssueCount}건</b></div>
          </div>
        </div>
      </div>
      <div class="section-title">산출물 요약</div>
      <div class="card">
        <div style="display:flex; height:14px; border-radius:7px; overflow:hidden; margin-bottom:10px;">${distBar}</div>
        <div style="display:flex; gap:18px; font-size:11px; color:var(--text-2); flex-wrap:wrap;">${distLegend}</div>
      </div>`;
  }

  // ================= 08 알림센터 =================
  let alertFilter = "전체";
  async function renderAlerts() {
    const kindParam = alertFilter === "전체" ? "" : `?kind=${encodeURIComponent(alertFilter)}`;
    const { items } = await api("GET", "/api/notifications" + kindParam);
    const colors = { "긴급": "#FE5B01", "지연": "#FE9704", "정보": "#0155FF" };
    const rows = items.map((n) => `
      <div class="card" style="border-left:4px solid ${colors[n.kind]}; margin-bottom:12px; display:flex; justify-content:space-between; align-items:flex-start; gap:16px;">
        <div>
          <span class="pill" style="background:${colors[n.kind]}22; color:${colors[n.kind]}; margin-bottom:8px;">${esc(n.kind)}</span>
          <div style="font-family:var(--font-bold); font-weight:700; font-size:13px; color:var(--text-1);">${esc(n.title)}</div>
          <div style="font-size:11.5px; color:var(--text-3); margin-top:4px;">${esc(n.detail || "")}</div>
        </div>
        <div style="font-size:11px; color:#b5b5b5; white-space:nowrap;">${esc((n.createdAt || "").replace("T", " ").slice(0, 16))}</div>
      </div>`).join("") || `<div class="empty-state">알림이 없습니다</div>`;

    $content.innerHTML = `
      <div style="display:flex; gap:10px; margin-bottom:18px;">
        ${["전체", "긴급", "지연", "정보"].map((v) => `<button class="chip ${alertFilter === v ? "active" : ""}" data-action="alert-filter" data-value="${v}">${v}</button>`).join("")}
      </div>
      ${rows}`;
  }

  // ================= 09 관리자 설정 =================
  async function renderAdmin() {
    const [settings, orgs, ds] = await Promise.all([
      api("GET", "/api/admin/settings"),
      api("GET", "/api/admin/orgs"),
      api("GET", "/api/admin/datasources"),
    ]);
    const threshold = settings.delay_threshold_pct || "5";

    const orgRows = orgs.items.map((o) => `
      <tr>
        <td>${orgTag(o.org)}</td>
        <td><input type="checkbox" data-action="org-perm" data-org="${o.org}" data-field="can_view" ${o.can_view ? "checked" : ""} style="accent-color:var(--blue); width:16px; height:16px;"></td>
        <td><input type="checkbox" data-action="org-perm" data-org="${o.org}" data-field="can_edit" ${o.can_edit ? "checked" : ""} style="accent-color:var(--blue); width:16px; height:16px;"></td>
        <td><input type="checkbox" data-action="org-perm" data-org="${o.org}" data-field="can_approve" ${o.can_approve ? "checked" : ""} style="accent-color:var(--blue); width:16px; height:16px;"></td>
      </tr>`).join("");

    const dsRows = ds.items.map((d) => `
      <tr><td>${esc(d.label)}</td><td><span class="pill pill-blue">${esc(d.status)}</span></td>
      <td>${esc(d.recordCount)}건 · ${esc((d.lastSync || "").replace("T", " ").slice(0, 16) || "-")}</td></tr>`).join("");

    $content.innerHTML = `
      <div class="grid g2">
        <div>
          <div class="section-title">지연 판정 임계값</div>
          <div class="card">
            <div class="card-sub" style="margin-bottom:14px;">계획 대비 실적 차이가 아래 값을 초과하면 '지연 후보'로 자동 표시합니다</div>
            <div style="display:flex; align-items:center; gap:16px;">
              <input type="range" min="1" max="20" value="${threshold}" id="threshold-range" style="flex:1; accent-color:var(--blue);">
              <div style="font-family:var(--font-title); color:var(--navy); font-size:18px;" id="threshold-label">${threshold}%p</div>
            </div>
            <button class="btn btn-primary" style="margin-top:16px;" id="save-threshold">저장</button>
          </div>

          <div class="section-title">알림 채널</div>
          <div class="card">
            ${[["notify_inapp", "대시보드 인앱 알림"], ["notify_email", "이메일 알림"], ["notify_messenger", "사내 메신저 연동"]].map(([key, label]) => `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--line);">
                <span style="font-size:12.5px;">${label}</span>
                <input type="checkbox" data-action="channel-toggle" data-key="${key}" ${settings[key] === "1" ? "checked" : ""} style="accent-color:var(--blue); width:18px; height:18px;">
              </div>`).join("")}
          </div>
        </div>

        <div>
          <div class="section-title">조직별 접근 권한</div>
          <div class="card" style="padding:0; overflow:hidden;">
            <table><thead><tr><th>조직</th><th>열람</th><th>수정</th><th>승인</th></tr></thead><tbody>${orgRows}</tbody></table>
          </div>

          <div class="section-title">데이터 소스 연동 상태</div>
          <div class="card" style="padding:0; overflow:hidden;">
            <table><thead><tr><th>소스</th><th>상태</th><th>레코드 · 마지막 갱신</th></tr></thead><tbody>${dsRows}</tbody></table>
          </div>
        </div>
      </div>`;

    document.getElementById("threshold-range").addEventListener("input", (e) => {
      document.getElementById("threshold-label").textContent = e.target.value + "%p";
    });
    document.getElementById("save-threshold").addEventListener("click", async () => {
      const v = document.getElementById("threshold-range").value;
      await api("POST", "/api/admin/settings", { delay_threshold_pct: v });
      toast("지연 판정 임계값이 저장되었습니다");
    });
  }

  const RENDERERS = {
    "00": renderDashboard, "01": renderProgress, "02": renderQna, "03": renderIssues,
    "04": renderMinutes, "05": renderActions, "06": renderDeliverables, "07": renderReport,
    "08": renderAlerts, "09": renderAdmin,
  };

  // ---------------- 전역 이벤트 위임 ----------------
  document.addEventListener("click", async (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { switchPage(nav.getAttribute("data-nav")); return; }

    const goto = e.target.closest("[data-goto]");
    if (goto) { switchPage(goto.getAttribute("data-goto")); return; }

    const act = e.target.closest("[data-action]");
    if (!act) return;
    const action = act.getAttribute("data-action");

    if (action === "progress-filter-org") { progressFilterOrg = act.dataset.value; renderProgress(); }
    else if (action === "progress-filter-status") { progressFilterStatus = act.dataset.value; renderProgress(); }
    else if (action === "issue-filter") { issueFilter = act.dataset.value; renderIssues(); }
    else if (action === "alert-filter") { alertFilter = act.dataset.value; renderAlerts(); }
    else if (action === "open-issue-modal") openIssueModal();
    else if (action === "open-action-modal") openActionModal();
    else if (action === "qna-quick") askQuestion(act.dataset.q);
    else if (action === "copy-link") {
      try { await navigator.clipboard.writeText(location.href); toast("링크가 복사되었습니다"); }
      catch { toast("클립보드 복사를 사용할 수 없습니다"); }
    }
  });

  document.addEventListener("change", async (e) => {
    const el = e.target;
    const action = el.getAttribute && el.getAttribute("data-action");
    if (!action) return;
    try {
      if (action === "update-progress") {
        await api("PATCH", `/api/progress/${el.dataset.id}`, { actual: Number(el.value) });
        renderProgress();
      } else if (action === "update-issue-status") {
        await api("PATCH", `/api/issues/${el.dataset.id}`, { status: el.value });
        toast("이슈 상태가 변경되었습니다");
        renderIssues();
      } else if (action === "update-deliverable-status") {
        await api("PATCH", `/api/deliverables/${el.dataset.id}`, { status: el.value });
        toast("산출물 상태가 변경되었습니다");
        renderDeliverables();
      } else if (action === "update-action-status") {
        await api("PATCH", `/api/actions/${el.dataset.id}`, { status: el.value });
        renderActions();
      } else if (action === "channel-toggle") {
        await api("POST", "/api/admin/settings", { [el.dataset.key]: el.checked ? "1" : "0" });
        toast("설정이 저장되었습니다");
      } else if (action === "org-perm") {
        const org = el.dataset.org;
        const rows = await api("GET", "/api/admin/orgs");
        const row = rows.items.find((r) => r.org === org);
        const payload = {
          canView: row.can_view, canEdit: row.can_edit, canApprove: row.can_approve,
        };
        const fieldMap = { can_view: "canView", can_edit: "canEdit", can_approve: "canApprove" };
        payload[fieldMap[el.dataset.field]] = el.checked ? 1 : 0;
        await api("POST", `/api/admin/orgs/${encodeURIComponent(org)}`, payload);
        toast("권한이 저장되었습니다");
      }
    } catch (err) { toast("오류: " + err.message); }
  });

  // ---------------- 초기화 ----------------
  (async function init() {
    await checkHealth();
    await refreshBell();
    renderNav();
    updateHeader(currentPage);
    switchPage("00");
    setInterval(refreshBell, 15000);
  })();
})();
