import {
  escapeHtml,
  formatBytes,
  formatDate,
  relativeTime,
  toArray,
  normalizeRole,
  normalizeStatus,
  getUserInitials
} from "./utils.js";

const ICONS = {
  "alert-triangle": '<path d="M10.3 3.2a2 2 0 0 1 3.4 0l8 13.8a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3l8-13.8Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  "file-text": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  filter: '<path d="M3 5h18"/><path d="M6 12h12"/><path d="M10 19h4"/>',
  "folder-open": '<path d="M4 19a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v2"/><path d="M2 17l2.2-6.4A2 2 0 0 1 6.1 9H22l-2.2 8.4A2 2 0 0 1 17.9 19Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  "layout-dashboard": '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  "log-in": '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  "log-out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  moon: '<path d="M20.9 13.4A8.6 8.6 0 0 1 10.6 3.1a9 9 0 1 0 10.3 10.3Z"/>',
  "more-horizontal": '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  pencil: '<path d="m18 2 4 4L8 20l-5 1 1-5Z"/><path d="M14 6l4 4"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.2 6.5"/><path d="M3 12A9 9 0 0 1 18.2 5.5"/><path d="M3 18h6v-6"/><path d="M21 6h-6v6"/>',
  "rotate-ccw": '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><path d="M7.5 7.5h.01"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  "upload-cloud": '<path d="M16 16l-4-4-4 4"/><path d="M12 12v9"/><path d="M20.4 17.4A5 5 0 0 0 18 8h-1.3A8 8 0 1 0 4 16.3"/><path d="M16 16l-4-4-4 4"/>',
  user: '<path d="M19 21a7 7 0 0 0-14 0"/><circle cx="12" cy="8" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
};

export function icon(name, className = "") {
  const body = ICONS[name] || ICONS.info;
  return `<svg class="${escapeHtml(className)}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export function installStaticIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    node.innerHTML = icon(node.dataset.icon);
  });
}

export function statusBadge(status) {
  const normalized = normalizeStatus(status);
  const label = normalized === "UNKNOWN" ? "Pending" : normalized.toLowerCase();
  const tone =
    normalized === "READY"
      ? "badge-ready"
      : normalized === "PROCESSING"
        ? "badge-processing"
        : normalized === "FAILED"
          ? "badge-failed"
          : "badge-warning";
  return `<span class="badge ${tone}">${escapeHtml(label)}</span>`;
}

export function roleBadge(role) {
  const normalized = normalizeRole(role);
  const tone = normalized === "OWNER" ? "badge-success" : normalized === "EDITOR" ? "badge-info" : "";
  return `<span class="badge ${tone}">${escapeHtml(normalized.toLowerCase())}</span>`;
}

export function tagList(tags, limit = 5) {
  const visible = toArray(tags).slice(0, limit);
  const extra = toArray(tags).length - visible.length;
  if (!visible.length) return `<span class="subtle">No tags</span>`;
  return `<div class="tag-list">${visible
    .map((tag) => `<span class="tag">${icon("tag")}${escapeHtml(tag)}</span>`)
    .join("")}${extra > 0 ? `<span class="tag">+${extra}</span>` : ""}</div>`;
}

export function emptyState({ title, message, actionLabel, action = "open-upload", iconName = "folder-open" }) {
  return `
    <div class="empty-state">
      <div class="empty-inner">
        <div class="empty-illustration" aria-hidden="true">${icon(iconName)}</div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        ${
          actionLabel
            ? `<button class="btn btn-primary" type="button" data-action="${escapeHtml(action)}">${icon("plus")}${escapeHtml(actionLabel)}</button>`
            : ""
        }
      </div>
    </div>
  `;
}

export function metricCard({ label, value, caption, iconName = "info", tone = "" }) {
  return `
    <article class="card metric-card ${escapeHtml(tone)}">
      <div class="metric-top">
        <span>${escapeHtml(label)}</span>
        ${icon(iconName)}
      </div>
      <div class="metric-value">${escapeHtml(value)}</div>
      <div class="metric-caption">${escapeHtml(caption || "")}</div>
    </article>
  `;
}

export function documentCard(document, options = {}) {
  const role = document.shareRole || document.role || (options.isOwner ? "OWNER" : "");
  const ownerActions = options.ownerContext
    ? `
      <button type="button" data-action="rename-document" data-document-id="${escapeHtml(document.documentId)}">${icon("pencil")}Rename</button>
      <button type="button" data-action="upload-version" data-document-id="${escapeHtml(document.documentId)}">${icon("upload-cloud")}Upload version</button>
      <button type="button" data-action="share-document" data-document-id="${escapeHtml(document.documentId)}">${icon("share")}Share</button>
      <button type="button" data-action="delete-document" data-document-id="${escapeHtml(document.documentId)}">${icon("trash")}Delete</button>
    `
    : "";
  return `
    <article class="card doc-card" data-document-id="${escapeHtml(document.documentId)}">
      <div class="doc-card-header">
        <div>
          <h3 class="doc-title">${escapeHtml(document.title || "Untitled document")}</h3>
          <div class="doc-meta">
            <span>Updated ${escapeHtml(relativeTime(document.updatedAt || document.createdAt))}</span>
            <span>Version ${escapeHtml(document.currentVersion || "-")}</span>
          </div>
        </div>
        ${statusBadge(document.processingStatus)}
      </div>
      ${tagList(document.tags)}
      <div class="doc-meta">
        <span>Owner ${escapeHtml(document.ownerId || "Unknown")}</span>
        ${role ? roleBadge(role) : ""}
      </div>
      <div class="doc-actions">
        <button class="btn btn-secondary" type="button" data-action="open-document" data-document-id="${escapeHtml(document.documentId)}">
          ${icon("file-text")}Open
        </button>
        <button class="icon-btn" type="button" data-action="download-document" data-document-id="${escapeHtml(document.documentId)}" aria-label="Download ${escapeHtml(document.title || "document")}">
          ${icon("download")}
        </button>
        <details class="context-menu">
          <summary class="icon-btn" aria-label="More actions">${icon("more-horizontal")}</summary>
          <div class="context-menu-list">
            <button type="button" data-action="open-document" data-document-id="${escapeHtml(document.documentId)}">${icon("file-text")}Open details</button>
            <button type="button" data-action="download-document" data-document-id="${escapeHtml(document.documentId)}">${icon("download")}Download</button>
            ${ownerActions}
          </div>
        </details>
      </div>
    </article>
  `;
}

export function documentTable(documents, options = {}) {
  if (!documents.length) return emptyState(options.empty || {});
  return `
    <div class="table-shell">
      <table class="data-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Tags</th>
            <th>Version</th>
            <th>Updated</th>
            <th class="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${documents
            .map(
              (document) => `
                <tr data-document-id="${escapeHtml(document.documentId)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(document.title || "document")}">
                  <td>
                    <strong class="break-word">${escapeHtml(document.title || "Untitled document")}</strong>
                    <div class="subtle">Owner ${escapeHtml(document.ownerId || "Unknown")}</div>
                  </td>
                  <td>${statusBadge(document.processingStatus)}</td>
                  <td>${tagList(document.tags, 3)}</td>
                  <td>v${escapeHtml(document.currentVersion || "-")}</td>
                  <td>${escapeHtml(formatDate(document.updatedAt || document.createdAt))}</td>
                  <td class="text-right">
                    <div class="cluster" style="justify-content:flex-end">
                      <button class="btn btn-secondary" type="button" data-action="open-document" data-document-id="${escapeHtml(document.documentId)}">${icon("file-text")}Open</button>
                      <button class="icon-btn" type="button" data-action="download-document" data-document-id="${escapeHtml(document.documentId)}" aria-label="Download">${icon("download")}</button>
                      ${
                        options.allowDelete
                          ? `<button class="icon-btn" type="button" data-action="delete-document" data-document-id="${escapeHtml(document.documentId)}" aria-label="Delete">${icon("trash")}</button>`
                          : ""
                      }
                    </div>
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function skeletonCards(count = 4) {
  return `<div class="grid document-grid">${Array.from({ length: count }, () => `
    <div class="card doc-card">
      <div class="skeleton" style="height:20px;width:70%"></div>
      <div class="skeleton" style="height:14px;width:45%"></div>
      <div class="skeleton" style="height:30px;width:100%"></div>
      <div class="skeleton" style="height:38px;width:54%;justify-self:end"></div>
    </div>
  `).join("")}</div>`;
}

export function fileMeta(file) {
  if (!file) return "";
  return `${escapeHtml(file.name)} - ${escapeHtml(formatBytes(file.size))}`;
}

export function userAvatar(user) {
  return escapeHtml(getUserInitials(user));
}
