import { documentCard, emptyState, icon } from "./components.js";
import {
  escapeHtml,
  highlight,
  loadRecentSearches,
  saveRecentSearch,
  sortByUpdatedAt,
  debounce
} from "./utils.js";

export function renderSearchView(app, initialQuery = "") {
  return `
    <div class="page-header">
      <div>
        <h2 class="page-title">Search</h2>
        <p class="page-subtitle">Search loaded owned and shared documents by title, tag, owner, status, and available AI keywords.</p>
      </div>
    </div>

    <div class="search-layout" data-search-root>
      <aside class="panel filter-panel">
        <div class="field">
          <label for="search-query">Search query</label>
          <input id="search-query" type="search" data-search-input value="${escapeHtml(initialQuery)}" placeholder="Search documents" />
        </div>
        <div class="filter-options" style="margin-top:16px">
          <strong>Scope</strong>
          <label><input type="checkbox" data-filter-scope value="owned" checked /> Owned documents</label>
          <label><input type="checkbox" data-filter-scope value="shared" checked /> Shared documents</label>
        </div>
        <div class="filter-options" style="margin-top:16px">
          <strong>Status</strong>
          <label><input type="checkbox" data-filter-status value="READY" checked /> Ready</label>
          <label><input type="checkbox" data-filter-status value="PROCESSING" checked /> Processing</label>
          <label><input type="checkbox" data-filter-status value="FAILED" checked /> Failed</label>
          <label><input type="checkbox" data-filter-status value="UNKNOWN" checked /> Other</label>
        </div>
        <div class="filter-options" style="margin-top:16px" data-recent-searches></div>
      </aside>

      <section class="stack-lg">
        <div class="toolbar">
          <div>
            <strong data-search-count>0 results</strong>
            <p class="muted mb-0">Results update as you type.</p>
          </div>
          <button class="btn btn-secondary" type="button" data-action="refresh">${icon("refresh")}Refresh Data</button>
        </div>
        <div data-search-results></div>
      </section>
    </div>
  `;
}

export function bindSearchView(root, app) {
  const searchRoot = root.querySelector("[data-search-root]");
  if (!searchRoot) return;

  const input = searchRoot.querySelector("[data-search-input]");
  const results = searchRoot.querySelector("[data-search-results]");
  const count = searchRoot.querySelector("[data-search-count]");
  const recent = searchRoot.querySelector("[data-recent-searches]");

  const renderRecent = () => {
    const searches = loadRecentSearches();
    recent.innerHTML = searches.length
      ? `<strong>Recent searches</strong><div class="cluster">${searches
          .map(
            (query) =>
              `<button class="chip" type="button" data-recent-query="${escapeHtml(query)}">${escapeHtml(query)}</button>`
          )
          .join("")}</div>`
      : `<strong>Recent searches</strong><p class="muted mb-0">Searches are stored locally in this browser.</p>`;
  };

  const render = () => {
    const query = input.value.trim();
    const scopes = checkedValues(searchRoot, "[data-filter-scope]");
    const statuses = checkedValues(searchRoot, "[data-filter-status]");
    const source = [
      ...(scopes.includes("owned") ? app.state.documents : []),
      ...(scopes.includes("shared") ? app.state.sharedDocuments : [])
    ];

    const matches = sortByUpdatedAt(source).filter((document) => {
      const status = document.processingStatus || "UNKNOWN";
      if (!statuses.includes(status)) return false;
      if (!query) return true;
      const haystack = [
        document.title,
        document.ownerId,
        document.processingStatus,
        document.summary,
        ...(document.tags || []),
        ...(document.keywords || [])
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query.toLowerCase());
    });

    count.textContent = `${matches.length} result${matches.length === 1 ? "" : "s"}`;
    results.innerHTML = matches.length
      ? `<div class="grid document-grid">${matches
          .map((document) => {
            const html = documentCard(document);
            return query
              ? html.replace(
                  escapeHtml(document.title || "Untitled document"),
                  highlight(document.title || "Untitled document", query)
                )
              : html;
          })
          .join("")}</div>`
      : emptyState({
          title: query ? "No search results" : "Start searching",
          message: query
            ? "Try a different term or broaden the filters."
            : "Search across titles, tags, owners, statuses, and available AI metadata.",
          iconName: "search"
        });
  };

  const renderDebounced = debounce(render, 120);

  input.addEventListener("input", renderDebounced);
  input.addEventListener("change", () => {
    saveRecentSearch(input.value);
    renderRecent();
  });
  searchRoot.addEventListener("change", render);
  searchRoot.addEventListener("click", (event) => {
    const button = event.target.closest("[data-recent-query]");
    if (!button) return;
    input.value = button.dataset.recentQuery;
    render();
  });

  renderRecent();
  render();
  input.focus();
}

function checkedValues(root, selector) {
  return Array.from(root.querySelectorAll(`${selector}:checked`)).map((input) => input.value);
}
