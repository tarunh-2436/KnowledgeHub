import { api } from "./api.js";
import { confirmDialog } from "./modal.js";
import { showToast } from "./toast.js";
import { emptyState, icon, statusBadge, tagList } from "./components.js";
import { escapeHtml, formatBytes, formatDate } from "./utils.js";

export function renderVersionTimeline(documentId, versions = [], currentVersion, permissions = {}) {
  if (!versions.length) {
    return emptyState({
      title: "No versions yet",
      message: "Version history appears after the first upload is ingested.",
      actionLabel: permissions.canUpload ? "Upload Version" : "",
      action: "upload-version",
      iconName: "clock"
    });
  }

  return `
    <ol class="timeline">
      ${versions
        .map((version) => {
          const isCurrent = Number(version.versionNumber) === Number(currentVersion);
          return `
            <li class="timeline-item">
              <div class="timeline-dot">${escapeHtml(version.versionNumber || "")}</div>
              <article class="timeline-card">
                <div class="section-header">
                  <div>
                    <h4>Version ${escapeHtml(version.versionNumber || "")}</h4>
                    <p>
                      Uploaded ${escapeHtml(formatDate(version.createdAt))}
                      ${version.uploadedBy ? ` by ${escapeHtml(version.uploadedBy)}` : ""}
                    </p>
                  </div>
                  <div class="cluster">
                    ${isCurrent ? '<span class="badge badge-success">current</span>' : ""}
                    ${statusBadge(version.processingStatus)}
                  </div>
                </div>
                ${
                  version.versionNotes
                    ? `<p>${escapeHtml(version.versionNotes)}</p>`
                    : '<p class="subtle">No version notes.</p>'
                }
                ${
                  version.summary
                    ? `<div class="summary-box" style="margin-top:12px"><h4>AI Summary</h4><p>${escapeHtml(version.summary)}</p></div>`
                    : ""
                }
                ${
                  version.keywords?.length
                    ? `<div style="margin-top:12px">${tagList(version.keywords, 10)}</div>`
                    : ""
                }
                <div class="doc-meta">
                  <span>${escapeHtml(version.filename || "Unknown file")}</span>
                  <span>${escapeHtml(formatBytes(version.fileSize))}</span>
                  ${version.processingError ? `<span style="color:var(--danger)">${escapeHtml(version.processingError)}</span>` : ""}
                </div>
                <div class="timeline-actions">
                  <button class="btn btn-secondary" type="button" data-action="download-version" data-document-id="${escapeHtml(documentId)}" data-version-number="${escapeHtml(version.versionNumber)}">${icon("download")}Download</button>
                  ${
                    permissions.canRestore && !isCurrent
                      ? `<button class="btn btn-secondary" type="button" data-action="restore-version" data-document-id="${escapeHtml(documentId)}" data-version-number="${escapeHtml(version.versionNumber)}">${icon("rotate-ccw")}Restore</button>`
                      : ""
                  }
                </div>
              </article>
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

export async function downloadVersion(documentId, versionNumber) {
  const version = await api.getVersion(documentId, versionNumber);
  if (!version.downloadUrl) {
    showToast("warning", "Download unavailable", "The backend did not return a download URL.");
    return;
  }
  window.open(version.downloadUrl, "_blank", "noopener");
}

export async function restoreVersion(app, documentId, versionNumber) {
  const confirmed = await confirmDialog({
    title: "Restore version",
    message:
      "Restoring creates a new current version from the selected version. The original history is kept.",
    confirmLabel: "Restore Version",
    tone: "primary"
  });

  if (!confirmed) return;

  await api.restoreVersion(documentId, versionNumber);
  showToast("success", "Restore started", "A new version will appear after ingestion completes.");
  await app.refreshData({ quiet: true });
  app.pollDocument(documentId);
  app.render();
}
