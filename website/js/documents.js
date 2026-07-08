import { api } from "./api.js";
import { confirmDialog, openModal } from "./modal.js";
import { openShareDialog } from "./sharing.js";
import { openUploadDialog } from "./upload.js";
import { renderVersionTimeline } from "./versions.js";
import { showToast } from "./toast.js";
import {
  documentCard,
  documentTable,
  emptyState,
  icon,
  roleBadge,
  statusBadge,
  tagList
} from "./components.js";
import {
  escapeHtml,
  formatDate,
  normalizeRole,
  parseTags,
  sortByUpdatedAt,
  toArray
} from "./utils.js";

export function renderDocumentsView(app, mode = "owned") {
  const isShared = mode === "shared";
  const documents = sortByUpdatedAt(isShared ? app.state.sharedDocuments : app.state.documents);
  const title = isShared ? "Shared Documents" : "My Documents";
  const subtitle = isShared
    ? "Documents colleagues have shared with you."
    : "Documents owned by your account.";

  return `
    <div class="page-header">
      <div>
        <h2 class="page-title">${title}</h2>
        <p class="page-subtitle">${subtitle}</p>
      </div>
      <div class="cluster">
        <button class="btn btn-secondary" type="button" data-action="refresh">${icon("refresh")}Refresh</button>
        ${isShared ? "" : `<button class="btn btn-primary" type="button" data-action="open-upload">${icon("upload-cloud")}Upload</button>`}
      </div>
    </div>

    <div class="toolbar">
      <div class="toolbar-group">
        <div class="segmented" data-view-toggle>
          <button type="button" class="is-active" data-action="set-document-view" data-view="cards">Cards</button>
          <button type="button" data-action="set-document-view" data-view="table">Table</button>
        </div>
      </div>
      <div class="toolbar-group">
        <input class="input" type="search" data-document-filter placeholder="Filter this list" aria-label="Filter documents" />
      </div>
    </div>

    <div data-document-results data-default-view="cards">
      ${renderDocumentResults(documents, isShared, "cards")}
    </div>
  `;
}

export function bindDocumentList(root, app, mode = "owned") {
  const results = root.querySelector("[data-document-results]");
  const filter = root.querySelector("[data-document-filter]");
  let view = results?.dataset.defaultView || "cards";

  const render = () => {
    const source = mode === "shared" ? app.state.sharedDocuments : app.state.documents;
    const query = filter?.value.trim().toLowerCase() || "";
    const filtered = sortByUpdatedAt(source).filter((document) => {
      if (!query) return true;
      const haystack = [
        document.title,
        document.ownerId,
        document.processingStatus,
        ...(document.tags || [])
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
    results.innerHTML = renderDocumentResults(filtered, mode === "shared", view);
  };

  filter?.addEventListener("input", render);
  root.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      view = button.dataset.view;
      root.querySelectorAll("[data-view]").forEach((node) => node.classList.toggle("is-active", node === button));
      render();
    });
  });
}

function renderDocumentResults(documents, isShared, view) {
  if (!documents.length) {
    return emptyState({
      title: isShared ? "No shared documents" : "No documents yet",
      message: isShared
        ? "Documents shared with you will appear here after access is granted."
        : "Upload a PDF, DOCX, TXT, or Markdown file to begin.",
      actionLabel: isShared ? "" : "Upload Document",
      iconName: isShared ? "users" : "folder-open"
    });
  }

  if (view === "table") {
    return documentTable(documents, {
      empty: {
        title: "No matches",
        message: "Try a different filter."
      }
    });
  }

  return `<div class="grid document-grid">${documents
    .map((document) => documentCard(document, { ownerContext: !isShared }))
    .join("")}</div>`;
}

export async function openDocumentDetails(app, documentId) {
  app.setLoading(true, "Loading document details");
  try {
    const [document, versions, shares] = await Promise.all([
      api.getDocument(documentId),
      api.listVersions(documentId).catch(() => []),
      api.listShares(documentId).catch(() => [])
    ]);

    const currentVersion =
      toArray(versions).find(
        (version) => Number(version.versionNumber) === Number(document.currentVersion)
      ) || toArray(versions)[0];

    const permissions = getDocumentPermissions(app, document);
    openModal({
      title: document.title || "Document Details",
      size: "wide",
      content: renderDocumentDetails(document, versions, currentVersion, permissions, shares)
    });
  } finally {
    app.setLoading(false);
  }
}

function renderDocumentDetails(document, versions, currentVersion, permissions, shares = []) {
  return `
    <div class="details-grid">
      <div class="detail-stack">
        <section class="panel">
          <div class="section-header">
            <div>
              <h3 class="mt-0 mb-0">${escapeHtml(document.title || "Untitled document")}</h3>
              <p class="muted mb-0">Version ${escapeHtml(document.currentVersion || "-")} - ${statusBadge(document.processingStatus)}</p>
            </div>
            <div class="cluster">
              ${document.downloadUrl ? `<button class="btn btn-secondary" type="button" data-action="download-document" data-document-id="${escapeHtml(document.documentId)}">${icon("download")}Download</button>` : ""}
              ${permissions.canRename ? `<button class="btn btn-secondary" type="button" data-action="rename-document" data-document-id="${escapeHtml(document.documentId)}">${icon("pencil")}Rename</button>` : ""}
              ${permissions.canShare ? `<button class="btn btn-secondary" type="button" data-action="share-document" data-document-id="${escapeHtml(document.documentId)}">${icon("share")}Share</button>` : ""}
            </div>
          </div>
          <div style="margin-top:14px">${tagList(document.tags, 10)}</div>
          ${document.processingError ? `<p style="color:var(--danger)">${escapeHtml(document.processingError)}</p>` : ""}
        </section>

        <section class="panel">
          <h3 class="mt-0">AI Summary</h3>
          ${
            currentVersion?.summary
              ? `<p>${escapeHtml(currentVersion.summary)}</p>`
              : `<p class="muted">The AI summary will appear after processing completes.</p>`
          }
          ${
            currentVersion?.keywords?.length
              ? `<div style="margin-top:12px">${tagList(currentVersion.keywords, 10)}</div>`
              : ""
          }
        </section>

        <section class="panel">
          <h3 class="mt-0">Audit History</h3>
          <div class="key-value">
            ${keyRow("Created", formatDate(document.createdAt))}
            ${keyRow("Updated", formatDate(document.updatedAt))}
            ${keyRow("Current Version", document.currentVersion)}
            ${keyRow("Version Count", toArray(versions).length)}
            ${keyRow("Processing", document.processingStatus)}
          </div>
        </section>

        <section class="panel">
          <div class="section-header">
            <div>
              <h3 class="mt-0 mb-0">Version History</h3>
              <p class="muted mb-0">Each upload is retained as a separate version.</p>
            </div>
            ${permissions.canUpload ? `<button class="btn btn-secondary" type="button" data-action="upload-version" data-document-id="${escapeHtml(document.documentId)}">${icon("upload-cloud")}Upload Version</button>` : ""}
          </div>
          <div style="margin-top:16px">
            ${renderVersionTimeline(versions, document.currentVersion, permissions)}
          </div>
        </section>
      </div>

      <aside class="detail-stack">
        <section class="panel">
          <h3 class="mt-0">Document Info</h3>
          <div class="key-value">
            ${keyRow("Owner", document.ownerId)}
            ${keyRow("Role", permissions.role)}
            ${keyRow("Status", document.processingStatus)}
            ${keyRow("Current Version", document.currentVersion)}
            ${keyRow("Created", formatDate(document.createdAt))}
            ${keyRow("Updated", formatDate(document.updatedAt))}
          </div>
        </section>

        <section class="panel">
          <h3 class="mt-0">Sharing</h3>
          ${renderSharingSummary(shares)}
        </section>

        <section class="panel">
          <h3 class="mt-0">Actions</h3>
          <div class="stack">
            ${permissions.canUpload ? `<button class="btn btn-secondary full-width" type="button" data-action="upload-version" data-document-id="${escapeHtml(document.documentId)}">${icon("upload-cloud")}Upload Version</button>` : ""}
            ${permissions.canShare ? `<button class="btn btn-secondary full-width" type="button" data-action="share-document" data-document-id="${escapeHtml(document.documentId)}">${icon("share")}Manage Sharing</button>` : ""}
            ${permissions.canDelete ? `<button class="btn btn-danger full-width" type="button" data-action="delete-document" data-document-id="${escapeHtml(document.documentId)}">${icon("trash")}Delete Document</button>` : ""}
          </div>
        </section>
      </aside>
    </div>
  `;
}

function keyRow(label, value) {
  return `<div class="key-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not available")}</strong></div>`;
}

function renderSharingSummary(shares) {
  const items = toArray(shares);
  if (!items.length) {
    return `<p class="muted mb-0">This document is private. Use sharing to grant access to specific users.</p>`;
  }

  return `
    <div class="stack">
      ${items.slice(0, 4).map((share) => `
        <div class="key-row" style="align-items:center">
          <div>
            <strong>${escapeHtml(share.sharedWithEmail || share.sharedWithUserId || "Unknown user")}</strong>
            <div class="subtle">${escapeHtml(share.sharedWithUserId || "")}</div>
          </div>
          <div class="cluster">${roleBadge(share.role)}</div>
        </div>
      `).join("")}
      ${items.length > 4 ? `<p class="muted mb-0">+${items.length - 4} more collaborators.</p>` : ""}
    </div>
  `;
}

export function getDocumentPermissions(app, document) {
  const userId = app.state.user?.sub;
  const role = document.ownerId === userId ? "OWNER" : normalizeRole(document.shareRole || document.role);
  const isAdmin = app.state.user?.isAdmin;
  return {
    role,
    canRename: role === "OWNER",
    canShare: role === "OWNER",
    canUpload: role === "OWNER" || role === "EDITOR",
    canRestore: role === "OWNER" || role === "EDITOR",
    canDelete: role === "OWNER" || isAdmin
  };
}

export async function downloadDocument(documentId) {
  const document = await api.getDocument(documentId);
  if (!document.downloadUrl) {
    showToast("warning", "Download unavailable", "The backend did not return a download URL.");
    return;
  }
  window.open(document.downloadUrl, "_blank", "noopener");
}

export async function openRenameDialog(app, documentId) {
  const document =
    app.findDocument(documentId) ||
    (await api.getDocument(documentId));
  const content = `
    <form class="stack" data-rename-form>
      <div class="field">
        <label for="rename-title">Title</label>
        <input id="rename-title" name="title" type="text" value="${escapeHtml(document.title || "")}" required />
      </div>
      <div class="field">
        <label for="rename-tags">Tags</label>
        <input id="rename-tags" name="tags" type="text" value="${escapeHtml(toArray(document.tags).join(", "))}" />
      </div>
      <div class="cluster">
        <button class="btn btn-primary" type="submit">${icon("check")}Save Changes</button>
      </div>
    </form>
  `;

  const modal = openModal({ title: "Rename Document", content });
  modal.querySelector("[data-rename-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api.updateDocument(documentId, {
      title: String(form.get("title") || "").trim(),
      tags: parseTags(form.get("tags"))
    });
    showToast("success", "Document updated", "The title and tags were saved.");
    await app.refreshData({ quiet: true });
    app.render();
    openDocumentDetails(app, documentId);
  });
}

export async function deleteDocument(app, documentId) {
  const document = app.findDocument(documentId);
  const confirmed = await confirmDialog({
    title: "Delete document",
    message: `Delete ${document?.title || "this document"} and all versions? This cannot be undone.`,
    confirmLabel: "Delete Document"
  });

  if (!confirmed) return;
  await api.deleteDocument(documentId);
  showToast("success", "Document deleted", "The document was removed.");
  await app.refreshData({ quiet: true });
  app.render();
}

export async function openShareForDocument(app, documentId) {
  const document = app.findDocument(documentId) || (await api.getDocument(documentId));
  await openShareDialog(app, document);
}

export async function openUploadVersion(app, documentId) {
  const document = app.findDocument(documentId) || (await api.getDocument(documentId));
  openUploadDialog(app, document);
}
