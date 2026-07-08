import {
  documentCard,
  emptyState,
  icon,
  metricCard,
  statusBadge
} from "./components.js";
import { escapeHtml, relativeTime, sortByUpdatedAt, toArray } from "./utils.js";

export function renderDashboard(app) {
  const documents = toArray(app.state.documents);
  const shared = toArray(app.state.sharedDocuments);
  const allDocuments = sortByUpdatedAt([...documents, ...shared]);
  const ready = documents.filter((document) => document.processingStatus === "READY").length;
  const processing = allDocuments.filter(
    (document) => document.processingStatus === "PROCESSING"
  );
  const failed = allDocuments.filter((document) => document.processingStatus === "FAILED");
  const recent = allDocuments.slice(0, 5);

  return `
    <section class="hero-band">
      <div>
        <h2>Welcome back${app.state.user?.email ? `, ${escapeHtml(app.state.user.email.split("@")[0])}` : ""}</h2>
        <p>Manage enterprise knowledge, track processing, and keep shared documents moving.</p>
      </div>
      <div class="quick-actions">
        <button class="btn btn-primary" type="button" data-action="open-upload">${icon("upload-cloud")}Upload</button>
        <button class="btn btn-secondary" type="button" data-route-link="documents">${icon("file-text")}My Documents</button>
        <button class="btn btn-secondary" type="button" data-route-link="search">${icon("search")}Search</button>
      </div>
    </section>

    <section class="grid metrics-grid" aria-label="Document statistics">
      ${metricCard({
        label: "Owned Documents",
        value: documents.length,
        caption: `${ready} ready for use`,
        iconName: "file-text"
      })}
      ${metricCard({
        label: "Shared With Me",
        value: shared.length,
        caption: "Documents from collaborators",
        iconName: "users"
      })}
      ${metricCard({
        label: "Processing",
        value: processing.length,
        caption: "AI enrichment in progress",
        iconName: "clock"
      })}
      ${metricCard({
        label: "Needs Attention",
        value: failed.length,
        caption: "Failed processing jobs",
        iconName: "alert-triangle",
        tone: failed.length ? "has-warning" : ""
      })}
    </section>

    <section class="grid content-grid" style="margin-top:18px">
      <div class="stack-lg">
        <div class="section-header">
          <div>
            <h3 class="mt-0 mb-0">Recent Documents</h3>
            <p class="muted mb-0">Your latest owned and shared knowledge.</p>
          </div>
          <button class="btn btn-secondary" type="button" data-route-link="documents">View all</button>
        </div>
        ${
          recent.length
            ? `<div class="grid document-grid">${recent
                .map((document) => documentCard(document))
                .join("")}</div>`
            : emptyState({
                title: "No documents yet",
                message: "Upload your first file to start building the knowledge base.",
                actionLabel: "Upload Document"
              })
        }
      </div>

      <aside class="stack-lg">
        <section class="panel">
          <div class="section-header">
            <div>
              <h3 class="mt-0 mb-0">Recent Activity</h3>
              <p class="muted mb-0">Derived from document updates.</p>
            </div>
          </div>
          ${renderActivity(allDocuments)}
        </section>

        <section class="panel">
          <div class="section-header">
            <div>
              <h3 class="mt-0 mb-0">Processing</h3>
              <p class="muted mb-0">Uploads currently being enriched.</p>
            </div>
          </div>
          ${renderProcessing(processing, failed)}
        </section>

        <section class="panel">
          <div class="section-header">
            <div>
              <h3 class="mt-0 mb-0">Shared Documents</h3>
              <p class="muted mb-0">Recently shared with you.</p>
            </div>
          </div>
          ${renderShared(shared)}
        </section>
      </aside>
    </section>
  `;
}

function renderActivity(documents) {
  if (!documents.length) {
    return `<p class="muted">Activity appears as documents are uploaded, updated, shared, and processed.</p>`;
  }

  return `
    <div class="activity-list">
      ${documents
        .slice(0, 6)
        .map(
          (document) => `
            <button class="activity-item" type="button" data-action="open-document" data-document-id="${escapeHtml(document.documentId)}">
              <span class="activity-icon">${icon("file-text")}</span>
              <span>
                <h4>${escapeHtml(document.title || "Untitled document")}</h4>
                <p>${statusBadge(document.processingStatus)} Updated ${escapeHtml(relativeTime(document.updatedAt || document.createdAt))}</p>
              </span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderProcessing(processing, failed) {
  const items = [...processing, ...failed].slice(0, 5);
  if (!items.length) {
    return `<p class="muted">No documents are processing right now.</p>`;
  }

  return `
    <div class="compact-list">
      ${items
        .map(
          (document) => `
            <button class="compact-item" type="button" data-action="open-document" data-document-id="${escapeHtml(document.documentId)}">
              <span class="file-icon">${icon(document.processingStatus === "FAILED" ? "alert-triangle" : "clock")}</span>
              <span>
                <h4>${escapeHtml(document.title || "Untitled document")}</h4>
                <p>${statusBadge(document.processingStatus)} ${escapeHtml(document.processingError || "Processing metadata")}</p>
              </span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderShared(shared) {
  if (!shared.length) {
    return `<p class="muted">Shared documents will appear here when colleagues grant access.</p>`;
  }

  return `
    <div class="compact-list">
      ${shared
        .slice(0, 4)
        .map(
          (document) => `
            <button class="compact-item" type="button" data-action="open-document" data-document-id="${escapeHtml(document.documentId)}">
              <span class="file-icon">${icon("users")}</span>
              <span>
                <h4>${escapeHtml(document.title || "Shared document")}</h4>
                <p>${escapeHtml(document.shareRole || document.role || "VIEWER")} access</p>
              </span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}
