import { diagnose } from "../engine/match.js";

const state = {
  knowledge: { components: [], cases: [], documents: [] },
  query: "",
  componentId: null,
  view: "search",
  caseId: null,
  lastResult: null,
  feedback: "",
};

const $ = (id) => document.getElementById(id);

async function loadKnowledge() {
  const [components, cases, documents] = await Promise.all([
    fetch("data/components.json").then((r) => r.json()),
    fetch("data/cases.json").then((r) => r.json()),
    fetch("data/documents.json").then((r) => r.json()),
  ]);
  state.knowledge = { components, cases, documents };
}

function byId(list, id) {
  return list.find((item) => item.id === id);
}

function parseHash() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = hash.split("?");
  const params = new URLSearchParams(qs || "");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "c" && parts[1]) {
    state.view = "browse";
    state.componentId = parts[1];
    state.caseId = null;
  } else if (parts[0] === "case" && parts[1]) {
    state.view = "detail";
    state.caseId = parts[1];
  } else {
    state.view = "search";
    state.caseId = null;
    state.query = params.get("q") || "";
    state.componentId = params.get("c") || null;
  }
}

function go(hash) {
  location.hash = hash;
}

function renderNav() {
  const list = $("comp-list");
  list.innerHTML = state.knowledge.components
    .map((c) => {
      const count = state.knowledge.cases.filter((x) => x.componentId === c.id).length;
      const active = state.componentId === c.id ? "active" : "";
      return `<li><button class="${active}" data-comp="${c.id}">${c.name}<small>${count} 条示范案例</small></button></li>`;
    })
    .join("");

  $("nav-search").classList.toggle("active", state.view === "search");
  $("nav-browse").classList.toggle("active", state.view === "browse" || (state.view === "detail" && state.componentId));
}

function renderChips() {
  $("chips").innerHTML = state.knowledge.components
    .map((c) => `<button class="chip ${state.componentId === c.id ? "active" : ""}" data-chip="${c.id}">${c.name}</button>`)
    .join("");
}

function docCards(refs) {
  const docs = (refs || []).map((id) => byId(state.knowledge.documents, id)).filter(Boolean);
  if (!docs.length) return `<p class="meta">文档引用位：暂无</p>`;
  return docs
    .map(
      (d) => `<div class="doc"><strong>${d.title}</strong><span>${d.source} · ${d.section}</span><div>${d.excerpt}</div></div>`
    )
    .join("");
}

function renderSearch() {
  $("query-input").value = state.query;
  renderChips();
  const out = $("results");
  const hasQuery = Boolean(state.query.trim());
  const hasChip = Boolean(state.componentId);

  if (!hasQuery && !hasChip) {
    out.innerHTML = `<p class="hint">输入口语、故障码，或点选部件后再检索。示范库每个部件 1 条案例。</p>`;
    return;
  }

  const result = diagnose(state.query, state.knowledge, { componentId: state.componentId, limit: 3 });
  state.lastResult = result;

  if (result.empty) {
    out.innerHTML = `
      <div class="empty">
        <h3>库里没有匹配的案例</h3>
        <p>当前示范库未能命中该描述或故障码。不要把空结果当成唯一结论。</p>
        <button class="btn" id="goto-browse">按部件浏览</button>
      </div>`;
    $("goto-browse").onclick = () => go("#/c/pitch");
    return;
  }

  out.innerHTML = result.hits
    .map((hit) => {
      const component = byId(state.knowledge.components, hit.case.componentId);
      const reasons = hit.reasons.map((r) => `<li>${r.text}</li>`).join("");
      return `
        <button class="hit" data-case="${hit.caseId}">
          <div class="hit-head">
            <h3>${hit.rank}. ${hit.case.faultMode}</h3>
            <span class="score">相关度 ${hit.score}</span>
          </div>
          <div class="meta">${component?.name || ""} · 故障码 ${hit.case.faultCodes.join(" / ")}</div>
          <div class="meta">命中原因</div>
          <ul class="reasons">${reasons}</ul>
          <div class="meta">文档引用</div>
          ${docCards(hit.case.documentRefs)}
        </button>`;
    })
    .join("");
}

function renderBrowse() {
  const component = byId(state.knowledge.components, state.componentId) || state.knowledge.components[0];
  state.componentId = component.id;
  const cases = state.knowledge.cases.filter((c) => c.componentId === component.id);
  $("browse-title").textContent = component.name;
  $("browse-sub").textContent = `该部件下 ${cases.length} 条故障模式（第 1 轮示范）`;
  $("browse-list").innerHTML = cases
    .map((c) => {
      const related = (c.relatedComponentIds || [])
        .map((id) => byId(state.knowledge.components, id)?.name)
        .filter(Boolean)
        .join("、");
      return `<button class="case-row" data-case="${c.id}">
        <strong>${c.faultMode}</strong>
        <div class="meta">故障码 ${c.faultCodes.join(" / ")}${related ? ` · 相关部件 ${related}` : ""}</div>
      </button>`;
    })
    .join("");
}

function renderDetail() {
  const item = byId(state.knowledge.cases, state.caseId);
  if (!item) {
    $("detail-root").innerHTML = `<div class="empty"><h3>未找到该案例</h3></div>`;
    return;
  }
  const component = byId(state.knowledge.components, item.componentId);
  const related = (item.relatedComponentIds || [])
    .map((id) => byId(state.knowledge.components, id)?.name)
    .filter(Boolean);
  const why =
    state.lastResult?.hits?.find((h) => h.caseId === item.id)?.reasons || [];

  $("detail-root").innerHTML = `
    <div class="crumb">
      <a href="#/c/${component.id}">${component.name}</a> / 案例详情
    </div>
    <h1>${item.faultMode}</h1>
    <div class="tags">
      ${item.faultCodes.map((c) => `<span class="tag code">${c}</span>`).join("")}
      <span class="tag">主部件：${component.name}</span>
      ${related.map((n) => `<span class="tag">相关：${n}</span>`).join("")}
    </div>
    <div class="grid-2">
      <div class="block">
        <h2>现象 / 同义词</h2>
        <ul>${[...item.symptoms, ...item.synonyms].map((x) => `<li>${x}</li>`).join("")}</ul>
      </div>
      <div class="block">
        <h2>可能原因</h2>
        <ul>${item.causes.map((x) => `<li>${x}</li>`).join("")}</ul>
      </div>
    </div>
    <div class="block" style="margin-top:12px">
      <h2>隔离 / 排查步骤</h2>
      <ol>${item.steps.map((x) => `<li>${x}</li>`).join("")}</ol>
    </div>
    <div class="block" style="margin-top:12px">
      <h2>文档引用（占位）</h2>
      ${docCards(item.documentRefs)}
    </div>
    ${
      why.length
        ? `<div class="block" style="margin-top:12px"><h2>相关度说明</h2><ul class="reasons">${why
            .map((r) => `<li>${r.text}</li>`)
            .join("")}</ul></div>`
        : ""
    }
    <div class="feedback">
      <button class="btn ghost ok" data-fb="useful">这条有用</button>
      <button class="btn ghost bad" data-fb="inaccurate">这条不准</button>
    </div>
    <div class="toast" id="fb-toast">${state.feedback}</div>
  `;
}

function render() {
  parseHash();
  renderNav();
  $("view-search").hidden = state.view !== "search";
  $("view-browse").hidden = state.view !== "browse";
  $("view-detail").hidden = state.view !== "detail";
  if (state.view === "search") renderSearch();
  if (state.view === "browse") renderBrowse();
  if (state.view === "detail") renderDetail();
}

function runSearch() {
  state.query = $("query-input").value;
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.componentId) params.set("c", state.componentId);
  const qs = params.toString();
  go(qs ? `#/?${qs}` : "#/");
}

function bind() {
  $("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch();
  });
  $("chips").addEventListener("click", (e) => {
    const id = e.target.closest("[data-chip]")?.dataset.chip;
    if (!id) return;
    state.componentId = state.componentId === id ? null : id;
    runSearch();
  });
  $("comp-list").addEventListener("click", (e) => {
    const id = e.target.closest("[data-comp]")?.dataset.comp;
    if (id) go(`#/c/${id}`);
  });
  $("results").addEventListener("click", (e) => {
    const id = e.target.closest("[data-case]")?.dataset.case;
    if (id) go(`#/case/${id}`);
  });
  $("browse-list").addEventListener("click", (e) => {
    const id = e.target.closest("[data-case]")?.dataset.case;
    if (id) go(`#/case/${id}`);
  });
  $("detail-root").addEventListener("click", (e) => {
    const fb = e.target.closest("[data-fb]")?.dataset.fb;
    if (!fb) return;
    state.feedback = fb === "useful" ? "已记录：这条有用（第 1 轮仅前端占位，无后端）。" : "已记录：这条不准（第 1 轮仅前端占位，无后端）。";
    const toast = $("fb-toast");
    if (toast) toast.textContent = state.feedback;
  });
  window.addEventListener("hashchange", render);
}

await loadKnowledge();
bind();
render();
