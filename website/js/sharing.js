import { api } from "./api.js";
import { openModal } from "./modal.js";
import { showToast } from "./toast.js";
import { emptyState, icon, roleBadge } from "./components.js";
import { escapeHtml, formatDate } from "./utils.js";

export async function openShareDialog(app, document) {
  const wrapper = window.document.createElement("div");
  wrapper.className = "stack-lg";

  openModal({
    title: `Share ${document.title || "Document"}`,
    content: wrapper,
    size: "wide"
  });

  await renderShares(wrapper, app, document);
}

async function renderShares(wrapper, app, document) {
  wrapper.innerHTML = `
    <div class="panel">
      <div class="section-header">
        <div>
          <strong>Owner</strong>
          <p class="muted mb-0">${escapeHtml(document.ownerId || "Unknown owner")}</p>
        </div>
        ${roleBadge("OWNER")}
      </div>
    </div>
    <div class="panel">
      <form class="grid" data-share-form>
        <div class="field">
          <label for="share-email">Add user by email</label>
          <input id="share-email" type="email" name="email" placeholder="teammate@company.com" required />
        </div>
        <div class="field">
          <label for="share-role">Permission</label>
          <select id="share-role" name="role">
            <option value="VIEWER">Viewer</option>
            <option value="EDITOR">Editor</option>
          </select>
        </div>
        <div>
          <button class="btn btn-primary" type="submit">${icon("share")}Share Document</button>
        </div>
      </form>
    </div>
    <div data-share-list>
      <div class="skeleton" style="height:140px"></div>
    </div>
  `;

  const list = wrapper.querySelector("[data-share-list]");
  const shares = await api.listShares(document.documentId).catch((error) => {
    list.innerHTML = emptyState({
      title: "Shares unavailable",
      message: error.message || "The sharing list could not be loaded.",
      iconName: "alert-triangle"
    });
    return null;
  });

  if (shares) {
    list.innerHTML = shares.length
      ? `
        <div class="table-shell">
          <table class="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Permission</th>
                <th>Date Shared</th>
                <th class="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${shares
                .map(
                  (share) => `
                    <tr>
                      <td>
                        <strong>${escapeHtml(share.sharedWithEmail || share.sharedWithUserId)}</strong>
                        <div class="subtle">${escapeHtml(share.sharedWithUserId || "")}</div>
                      </td>
                      <td>${roleBadge(share.role)}</td>
                      <td>${escapeHtml(formatDate(share.createdAt))}</td>
                      <td class="text-right">
                        <button class="btn btn-secondary" type="button" data-remove-share="${escapeHtml(share.sharedWithUserId)}">${icon("trash")}Remove</button>
                      </td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `
      : emptyState({
          title: "No shared users",
          message: "Add a colleague to give them access to this document.",
          iconName: "users"
        });
  }

  wrapper.querySelector("[data-share-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const role = String(form.get("role") || "VIEWER").toUpperCase();
    if (!email) return;

    await api.shareDocument(document.documentId, { email, role });
    showToast("success", "Permission updated", `${email} can now access this document.`);
    await app.refreshData({ quiet: true });
    await renderShares(wrapper, app, document);
  });

  wrapper.querySelectorAll("[data-remove-share]").forEach((button) => {
    button.addEventListener("click", async () => {
      const userId = button.dataset.removeShare;
      await api.deleteShare(document.documentId, userId);
      showToast("success", "Permission removed", "The user no longer has access.");
      await app.refreshData({ quiet: true });
      await renderShares(wrapper, app, document);
    });
  });
}
