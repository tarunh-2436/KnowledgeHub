import { api } from "./api.js";
import { documentTable, emptyState, icon, metricCard, statusBadge } from "./components.js";
import { escapeHtml, sortByUpdatedAt, toArray } from "./utils.js";

export async function ensureAdminData(app) {
  if (!app.state.user?.isAdmin) return;
  if (app.state.adminStats && !app.state.adminError) return;

  try {
    const [stats, documents, processing] = await Promise.all([
      api.getAdminStatistics(),
      api.getAdminDocuments(),
      api.getAdminProcessing()
    ]);
    app.state.adminStats = stats;
    app.state.adminDocuments = documents;
    app.state.adminProcessing = processing;
    app.state.adminError = null;
  } catch (error) {
    app.state.adminError = error;
  }
}

export function renderAdminView(app) {
  if (!app.state.user?.isAdmin) {
    return emptyState({
      title: "Admin access required",
      message: "Only users in the Cognito admins group can access platform administration.",
      iconName: "shield"
    });
  }

  if (app.state.adminError) {
    return emptyState({
      title: "Admin data unavailable",
      message: app.state.adminError.message,
      iconName: "alert-triangle"
    });
  }

  const stats = app.state.adminStats || {};
  const processing = toArray(app.state.adminProcessing?.processing);
  const failed = toArray(app.state.adminProcessing?.failed);
  const documents = sortByUpdatedAt(app.state.adminDocuments || []);
  const totalDocuments = Number(stats.totalDocuments || documents.length || 0);
  const totalJobs = Math.max(1, Number(stats.processingDocuments || 0) + Number(stats.failedDocuments || 0));

  return `
    <div class="page-header">
      <div>
        <h2 class="page-title">Admin</h2>
        <p class="page-subtitle">Platform statistics, processing health, and global document controls.</p>
      </div>
      <button class="btn btn-secondary" type="button" data-action="refresh-admin">${icon("refresh")}Refresh Admin Data</button>
    </div>

    <section class="grid metrics-grid">
      ${metricCard({ label: "Total Users", value: stats.totalUsers ?? "-", caption: "Cognito users", iconName: "users" })}
      ${metricCard({ label: "Total Documents", value: totalDocuments, caption: "Across the platform", iconName: "file-text" })}
      ${metricCard({ label: "Processing", value: stats.processingDocuments ?? processing.length, caption: "In progress", iconName: "clock" })}
      ${metricCard({ label: "Failed", value: stats.failedDocuments ?? failed.length, caption: "Require attention", iconName: "alert-triangle" })}
    </section>

    <section class="grid content-grid" style="margin-top:18px">
      <div class="stack-lg">
        <section class="panel">
          <div class="section-header">
            <div>
              <h3 class="mt-0 mb-0">Global Document Browser</h3>
              <p class="muted mb-0">All documents exposed by the admin endpoint.</p>
            </div>
          </div>
          <div style="margin-top:14px">
            ${documentTable(documents, {
              allowDelete: true,
              empty: {
                title: "No platform documents",
                message: "Documents will appear after users upload content.",
                iconName: "file-text"
              }
            })}
          </div>
        </section>
      </div>

      <aside class="stack-lg">
        <section class="panel">
          <h3 class="mt-0">System Health</h3>
          <div class="admin-bars">
            ${barRow("Processing", stats.processingDocuments || processing.length, totalJobs)}
            ${barRow("Failed", stats.failedDocuments || failed.length, totalJobs)}
            ${barRow("Ready", Math.max(0, totalDocuments - (stats.processingDocuments || 0) - (stats.failedDocuments || 0)), Math.max(1, totalDocuments))}
          </div>
        </section>

        <section class="panel">
          <h3 class="mt-0">Processing Queue</h3>
          ${renderProcessingList(processing, "No documents are currently processing.")}
        </section>

        <section class="panel">
          <h3 class="mt-0">Failed Processing</h3>
          ${renderProcessingList(failed, "No failed processing jobs.", true)}
        </section>
      </aside>
    </section>
  `;
}

function barRow(label, value, total) {
  const percent = Math.round((Number(value || 0) / Math.max(1, total)) * 100);
  return `
    <div class="bar-row">
      <span>${escapeHtml(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="--bar:${percent}%"></div></div>
      <strong>${escapeHtml(value || 0)}</strong>
    </div>
  `;
}

function renderProcessingList(items, emptyMessage, isFailed = false) {
  if (!items.length) return `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
  return `
    <div class="compact-list">
      ${items
        .slice(0, 8)
        .map(
          (document) => `
            <button class="compact-item" type="button" data-action="open-document" data-document-id="${escapeHtml(document.documentId)}">
              <span class="file-icon">${icon(isFailed ? "alert-triangle" : "clock")}</span>
              <span>
                <h4>${escapeHtml(document.title || document.documentId)}</h4>
                <p>${statusBadge(document.processingStatus)} ${escapeHtml(document.processingError || "")}</p>
              </span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}
