import { isConfigured, getConfigStatus } from "./config.js";
import { auth } from "./auth.js";
import { api, ApiError } from "./api.js";
import { store } from "./state.js";
import { renderDashboard } from "./dashboard.js";
import {
  bindDocumentList,
  renderDocumentsView,
  deleteDocument,
  downloadDocument,
  openDocumentDetails,
  openRenameDialog,
  openShareForDocument,
  openUploadVersion
} from "./documents.js";
import { renderUploadView, mountUploadExperience, openUploadDialog } from "./upload.js";
import { downloadVersion, restoreVersion } from "./versions.js";
import { bindSearchView, renderSearchView } from "./search.js";
import { ensureAdminData, renderAdminView } from "./admin.js";
import { installStaticIcons, icon } from "./components.js";
import { initModals } from "./modal.js";
import { initToasts, showToast } from "./toast.js";
import {
  STORAGE_KEYS,
  debounce,
  escapeHtml,
  getUserInitials,
  saveRecentSearch,
  sleep,
  sortByUpdatedAt,
  toArray
} from "./utils.js";

class KnowledgeHubApp {
  constructor() {
    this.state = store;
    this.elements = {
      authScreen: document.querySelector("[data-auth-screen]"),
      authNote: document.querySelector("[data-auth-note]"),
      shell: document.querySelector("[data-shell]"),
      sidebar: document.querySelector("[data-sidebar]"),
      scrim: document.querySelector(".mobile-scrim"),
      page: document.querySelector("[data-page]"),
      breadcrumbs: document.querySelector("[data-breadcrumbs]"),
      loading: document.querySelector("[data-loading-overlay]"),
      loadingMessage: document.querySelector("[data-loading-message]"),
      themeIcon: document.querySelector("[data-theme-icon]"),
      notificationDot: document.querySelector("[data-notification-dot]"),
      notificationPopover: document.querySelector("[data-notification-popover]"),
      profilePopover: document.querySelector("[data-profile-popover]"),
      userAvatar: document.querySelector("[data-user-avatar]"),
      userEmail: document.querySelector("[data-user-email]"),
      userRole: document.querySelector("[data-user-role]")
    };
  }

  async init() {
    installStaticIcons();
    initToasts();
    initModals();
    this.initTheme();
    this.bindEvents();

    try {
      const user = await auth.init();
      this.state.user = user;
      if (user) {
        this.showShell();
        await this.refreshData({ quiet: false });
        await this.handleRouteChange();
      } else {
        this.showAuth();
      }
    } catch (error) {
      this.handleError(error);
      this.showAuth();
    }
  }

  bindEvents() {
    document.addEventListener("click", (event) => {
      const routeButton = event.target.closest("[data-route-link]");
      if (routeButton) {
        event.preventDefault();
        this.navigate(routeButton.dataset.routeLink);
        return;
      }

      const documentRow = event.target.closest("tr[data-document-id]");
      if (documentRow && !event.target.closest("button, a, input, select, textarea, summary, [data-action]")) {
        event.preventDefault();
        this.handleAction({ dataset: { action: "open-document", documentId: documentRow.dataset.documentId }, closest: () => documentRow }).catch((error) => this.handleError(error));
        return;
      }

      const actionElement = event.target.closest("[data-action]");
      if (!actionElement) return;
      const uploadRoot = actionElement.closest("[data-upload-root]");
      if (uploadRoot && ["browse-file", "clear-file", "start-upload", "cancel-upload", "retry-upload"].includes(actionElement.dataset.action)) {
        return;
      }
      event.preventDefault();
      this.handleAction(actionElement).catch((error) => this.handleError(error));
    });


    document.addEventListener("keydown", (event) => {
      const documentRow = event.target.closest("tr[data-document-id]");
      if (!documentRow) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this.handleAction({ dataset: { action: "open-document", documentId: documentRow.dataset.documentId }, closest: () => documentRow }).catch((error) => this.handleError(error));
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".popover-wrap")) {
        this.closePopovers();
      }
    });

    window.addEventListener("hashchange", () => {
      this.handleRouteChange().catch((error) => this.handleError(error));
    });

    document.querySelector("[data-global-search]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = new FormData(event.currentTarget).get("q");
      saveRecentSearch(query);
      this.navigate("search", { q: String(query || "").trim() });
    });

    window.addEventListener("offline", () =>
      showToast("warning", "You are offline", "Some actions will be unavailable until the network returns.")
    );
    window.addEventListener("online", () =>
      showToast("success", "Back online", "KnowledgeHub can reach the network again.")
    );

    auth.addEventListener("authchange", (event) => {
      this.state.user = event.detail.user;
      if (!event.detail.user) this.showAuth();
    });
  }

  async handleAction(element) {
    const action = element.dataset.action;
    const documentId = element.dataset.documentId || element.closest("[data-document-id]")?.dataset.documentId;
    const versionNumber = element.dataset.versionNumber;

    switch (action) {
      case "login":
        await auth.login(window.location.hash || "#dashboard");
        break;
      case "logout":
        auth.logout();
        break;
      case "toggle-theme":
        this.toggleTheme();
        break;
      case "set-theme":
        this.setTheme(element.dataset.themeValue);
        break;
      case "toggle-sidebar":
        this.toggleSidebar();
        break;
      case "toggle-notifications":
        this.togglePopover("notifications", element);
        break;
      case "toggle-profile":
        this.togglePopover("profile", element);
        break;
      case "refresh":
        await this.refreshData({ quiet: false });
        this.render();
        break;
      case "refresh-admin":
        this.state.adminStats = null;
        await ensureAdminData(this);
        this.render();
        break;
      case "open-upload":
        openUploadDialog(this);
        break;
      case "open-document":
        await openDocumentDetails(this, documentId);
        break;
      case "download-document":
        await downloadDocument(documentId);
        break;
      case "rename-document":
        await openRenameDialog(this, documentId);
        break;
      case "delete-document":
        await deleteDocument(this, documentId);
        break;
      case "share-document":
        await openShareForDocument(this, documentId);
        break;
      case "upload-version":
        await openUploadVersion(this, documentId);
        break;
      case "download-version":
        await downloadVersion(documentId, versionNumber);
        break;
      case "restore-version":
        await restoreVersion(this, documentId, versionNumber);
        break;
      default:
        break;
    }
  }

  async handleRouteChange() {
    if (!auth.user) {
      this.showAuth();
      return;
    }

    const { route, params } = this.getRoute();
    this.state.currentRoute = route;
    this.state.routeParams = params;

    if (route === "admin") {
      this.setLoading(true, "Loading admin data");
      await ensureAdminData(this);
      this.setLoading(false);
    }

    this.elements.sidebar.classList.remove("is-open");
    this.elements.scrim.hidden = true;

    this.render();
  }

  navigate(route, params = {}) {
    const query = new URLSearchParams(params).toString();
    window.location.hash = query ? `${route}?${query}` : route;
  }

  getRoute() {
    const hash = window.location.hash.replace(/^#/, "");
    const [rawRoute, rawQuery = ""] = hash.split("?");
    const route = normalizeRoute(rawRoute || "dashboard");
    return {
      route,
      params: Object.fromEntries(new URLSearchParams(rawQuery))
    };
  }

  async refreshData({ quiet = true } = {}) {
    if (!auth.user) return;
    if (!isConfigured()) {
      this.state.loadError = new Error(
        `Frontend configuration is missing: ${getConfigStatus().missing.join(", ")}`
      );
      return;
    }

    if (!quiet) this.setLoading(true, "Refreshing documents");
    try {
      const [documents, sharedDocuments] = await Promise.all([
        api.listDocuments(),
        api.listSharedDocuments()
      ]);
      this.state.documents = sortByUpdatedAt(documents);
      this.state.sharedDocuments = sortByUpdatedAt(sharedDocuments);
      this.state.loadError = null;
      this.state.loadedAt = new Date().toISOString();
      this.updateNotifications();
    } catch (error) {
      this.state.loadError = error;
      if (!quiet) this.handleError(error);
    } finally {
      if (!quiet) this.setLoading(false);
    }
  }

  render() {
    if (!auth.user) {
      this.showAuth();
      return;
    }

    this.showShell();
    const route = this.state.currentRoute || "dashboard";
    this.updateNavigation(route);
    this.updateBreadcrumbs(route);
    this.updateNotifications();

    const errorBanner = this.state.loadError
      ? `<div class="panel" style="border-color:var(--danger);margin-bottom:16px">
          <strong>Some data could not be loaded.</strong>
          <p class="muted mb-0">${escapeHtml(this.state.loadError.message || "Try refreshing the page.")}</p>
        </div>`
      : "";

    const pageHtml = {
      dashboard: () => renderDashboard(this),
      documents: () => renderDocumentsView(this, "owned"),
      shared: () => renderDocumentsView(this, "shared"),
      upload: () => renderUploadView(this),
      search: () => renderSearchView(this, this.state.routeParams?.q || ""),
      admin: () => renderAdminView(this),
    }[route]?.() || renderDashboard(this);

    this.elements.page.innerHTML = errorBanner + pageHtml;
    installStaticIcons(this.elements.page);
    this.afterRender(route);
  }

  afterRender(route) {
    if (route === "upload") {
      const root = this.elements.page.querySelector("[data-upload-root]");
      if (root) mountUploadExperience(root, this);
    }
    if (route === "documents") bindDocumentList(this.elements.page, this, "owned");
    if (route === "shared") bindDocumentList(this.elements.page, this, "shared");
    if (route === "search") bindSearchView(this.elements.page, this);
  }

  showAuth() {
    this.elements.shell.classList.add("is-hidden");
    this.elements.authScreen.classList.remove("is-hidden");
    const status = getConfigStatus();
    this.elements.authNote.textContent = status.ready
      ? "Secure access is provided by Amazon Cognito Hosted UI."
      : `Frontend configuration is incomplete: ${status.missing.join(", ")}. Terraform generates config.js during deployment.`;
  }

  showShell() {
    this.elements.authScreen.classList.add("is-hidden");
    this.elements.shell.classList.remove("is-hidden");
    this.elements.shell.classList.toggle("is-admin", Boolean(this.state.user?.isAdmin));
    this.elements.userAvatar.textContent = getUserInitials(this.state.user);
    this.elements.userEmail.textContent = this.state.user?.email || "Signed in";
    this.elements.userRole.textContent = this.state.user?.isAdmin ? "Administrator" : "Member";
  }

  setLoading(active, message = "Loading") {
    this.elements.loading.hidden = !active;
    this.elements.loadingMessage.textContent = message;
  }

  updateNavigation(route) {
    document.querySelectorAll("[data-route]").forEach((link) => {
      link.classList.toggle("is-active", link.dataset.route === route);
    });
  }

  updateBreadcrumbs(route) {
    const labels = {
      dashboard: "Dashboard",
      documents: "My Documents",
      shared: "Shared Documents",
      upload: "Upload",
      search: "Search",
      admin: "Admin",
    };
    this.elements.breadcrumbs.textContent = `KnowledgeHub / ${labels[route] || "Dashboard"}`;
  }

  updateNotifications() {
    const failed = this.allDocuments().filter((document) => document.processingStatus === "FAILED");
    const processing = this.allDocuments().filter(
      (document) => document.processingStatus === "PROCESSING"
    );
    const notifications = [
      ...failed.map((document) => ({
        tone: "danger",
        title: `${document.title || "Document"} failed processing`,
        message: document.processingError || "Open the document for details.",
        documentId: document.documentId
      })),
      ...processing.slice(0, 5).map((document) => ({
        tone: "info",
        title: `${document.title || "Document"} is processing`,
        message: "AI summary and keywords will appear when ready.",
        documentId: document.documentId
      }))
    ];

    this.elements.notificationDot.hidden = notifications.length === 0;
    this.elements.notificationPopover.innerHTML = notifications.length
      ? `<div class="notification-list">${notifications
          .map(
            (item) => `
              <button class="notification-item" type="button" data-action="open-document" data-document-id="${escapeHtml(item.documentId)}">
                <span class="file-icon">${icon(item.tone === "danger" ? "alert-triangle" : "clock")}</span>
                <span>
                  <h4>${escapeHtml(item.title)}</h4>
                  <p>${escapeHtml(item.message)}</p>
                </span>
              </button>
            `
          )
          .join("")}</div>`
      : `<div class="notification-item"><span class="file-icon">${icon("bell")}</span><span><h4>No notifications</h4><p>Processing and permission updates will appear here.</p></span></div>`;
  }

  togglePopover(name, trigger = null) {
    const target =
      name === "notifications" ? this.elements.notificationPopover : this.elements.profilePopover;
    const other =
      name === "notifications" ? this.elements.profilePopover : this.elements.notificationPopover;
    other.hidden = true;
    this.setPopoverExpanded(name, false);
    target.hidden = !target.hidden;
    this.setPopoverExpanded(name, !target.hidden);
    if (trigger) {
      trigger.setAttribute("aria-expanded", String(!target.hidden));
    }
  }

  closePopovers() {
    this.elements.notificationPopover.hidden = true;
    this.elements.profilePopover.hidden = true;
    this.setPopoverExpanded("notifications", false);
    this.setPopoverExpanded("profile", false);
  }

  setPopoverExpanded(name, expanded) {
    if (name === "notifications") {
      document.querySelector('[data-action="toggle-notifications"]')?.setAttribute("aria-expanded", String(expanded));
    }
    if (name === "profile") {
      document.querySelector('[data-action="toggle-profile"]')?.setAttribute("aria-expanded", String(expanded));
    }
  }

  toggleSidebar() {
    const open = !this.elements.sidebar.classList.contains("is-open");
    this.elements.sidebar.classList.toggle("is-open", open);
    this.elements.scrim.hidden = !open;
  }

  initTheme() {
    const stored = localStorage.getItem(STORAGE_KEYS.theme);
    this.applyTheme(stored || systemTheme(), false);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener(
      "change",
      debounce(() => {
        if (!localStorage.getItem(STORAGE_KEYS.theme)) this.applyTheme(systemTheme(), false);
      }, 50)
    );
  }

  toggleTheme() {
    const current = document.documentElement.dataset.theme || systemTheme();
    this.setTheme(current === "dark" ? "light" : "dark");
  }

  setTheme(value) {
    if (value === "system") {
      localStorage.removeItem(STORAGE_KEYS.theme);
      this.applyTheme(systemTheme(), false);
      showToast("info", "Theme set to system", "KnowledgeHub will follow your device setting.");
      return;
    }
    localStorage.setItem(STORAGE_KEYS.theme, value);
    this.applyTheme(value, true);
  }

  applyTheme(theme, notify) {
    document.documentElement.dataset.theme = theme;
    this.elements.themeIcon.innerHTML = icon(theme === "dark" ? "moon" : "sun");
    if (notify) showToast("success", "Theme updated", `${theme === "dark" ? "Dark" : "Light"} theme enabled.`);
  }

  allDocuments() {
    const seen = new Map();
    [...toArray(this.state.documents), ...toArray(this.state.sharedDocuments), ...toArray(this.state.adminDocuments)].forEach((document) => {
      if (document?.documentId && !seen.has(document.documentId)) {
        seen.set(document.documentId, document);
      }
    });
    return Array.from(seen.values());
  }

  findDocument(documentId) {
    return this.allDocuments().find((document) => document.documentId === documentId);
  }

  pollDocument(documentId) {
    if (!documentId) return;
    void (async () => {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await sleep(3500);
        try {
          const document = await api.getDocument(documentId);
          if (["READY", "FAILED"].includes(document.processingStatus)) {
            showToast(
              document.processingStatus === "READY" ? "success" : "error",
              document.processingStatus === "READY" ? "Processing complete" : "Processing failed",
              document.title || documentId
            );
            await this.refreshData({ quiet: true });
            this.render();
            return;
          }
        } catch (error) {
          if (!(error instanceof ApiError) || ![400, 404].includes(error.status)) {
            return;
          }
        }
      }
      await this.refreshData({ quiet: true });
      this.render();
    })();
  }

  handleError(error) {
    const message = error?.message || "Something went wrong.";
    if (error instanceof ApiError && error.status === 401) {
      auth.clearSession();
      showToast("warning", "Session expired", "Please sign in again.");
      this.showAuth();
      return;
    }
    showToast("error", "Action failed", message);
  }
}

function normalizeRoute(route) {
  const allowed = new Set(["dashboard", "documents", "shared", "upload", "search", "admin"]);
  return allowed.has(route) ? route : "dashboard";
}

function systemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const app = new KnowledgeHubApp();
window.knowledgeHub = app;
app.init();
