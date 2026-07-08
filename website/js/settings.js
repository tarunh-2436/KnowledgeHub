import { CONFIG, getConfigStatus } from "./config.js";
import { icon, roleBadge } from "./components.js";
import { escapeHtml } from "./utils.js";

export function renderSettingsView(app) {
  const status = getConfigStatus();
  return `
    <div class="page-header">
      <div>
        <h2 class="page-title">Settings</h2>
        <p class="page-subtitle">Account, theme, and frontend configuration.</p>
      </div>
    </div>

    <div class="grid content-grid">
      <section class="stack-lg">
        <div class="panel">
          <h3 class="mt-0">Profile</h3>
          <div class="key-value">
            ${row("Email", app.state.user?.email)}
            ${row("User ID", app.state.user?.sub)}
            ${row("Role", app.state.user?.isAdmin ? roleBadge("OWNER") : roleBadge("VIEWER"), true)}
          </div>
        </div>

        <div class="panel">
          <h3 class="mt-0">Theme</h3>
          <p class="muted">KnowledgeHub follows your system preference until you choose a manual theme.</p>
          <div class="cluster">
            <button class="btn btn-secondary" type="button" data-action="set-theme" data-theme-value="light">${icon("sun")}Light</button>
            <button class="btn btn-secondary" type="button" data-action="set-theme" data-theme-value="dark">${icon("moon")}Dark</button>
            <button class="btn btn-secondary" type="button" data-action="set-theme" data-theme-value="system">${icon("settings")}System</button>
          </div>
        </div>

        <div class="panel">
          <h3 class="mt-0">Supported Uploads</h3>
          <p class="muted">The backend validates file extension and content type.</p>
          <div class="cluster">
            <span class="tag">PDF</span>
            <span class="tag">DOCX</span>
            <span class="tag">TXT</span>
            <span class="tag">Markdown</span>
          </div>
        </div>
      </section>

      <aside class="panel">
        <h3 class="mt-0">Frontend Configuration</h3>
        <div class="key-value">
          ${row("Status", status.ready ? "Ready" : `Missing ${status.missing.join(", ")}`)}
          ${row("API Endpoint", CONFIG.apiEndpoint)}
          ${row("AWS Region", CONFIG.awsRegion)}
          ${row("User Pool", CONFIG.userPoolId)}
          ${row("Client ID", CONFIG.userPoolClientId)}
          ${row("Cognito Domain", CONFIG.cognitoDomain)}
        </div>
      </aside>
    </div>
  `;
}

function row(label, value, raw = false) {
  return `<div class="key-row"><span>${escapeHtml(label)}</span><strong>${raw ? value : escapeHtml(value || "Not available")}</strong></div>`;
}
