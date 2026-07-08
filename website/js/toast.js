import { escapeHtml } from "./utils.js";
import { icon } from "./components.js";

let region;
const queue = [];
const MAX_VISIBLE = 4;

export function initToasts(root = document) {
  region = root.querySelector("[data-toast-region]");
}

export function showToast(type = "info", title = "Notification", message = "", options = {}) {
  if (!region) initToasts();

  const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.id = id;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `
    <div class="toast-icon">${icon(type === "error" ? "alert-triangle" : type === "success" ? "check" : type === "warning" ? "alert-triangle" : "info")}</div>
    <div>
      <h4>${escapeHtml(title)}</h4>
      ${message ? `<p>${escapeHtml(message)}</p>` : ""}
    </div>
    <button class="icon-btn" type="button" aria-label="Dismiss notification">${icon("x")}</button>
  `;

  toast.querySelector("button").addEventListener("click", () => dismissToast(toast));
  queue.push(toast);
  flushToasts();

  const duration = options.duration ?? (type === "error" ? 7000 : 4500);
  if (duration > 0) {
    window.setTimeout(() => dismissToast(toast), duration);
  }

  return id;
}

function flushToasts() {
  if (!region) return;
  while (region.children.length >= MAX_VISIBLE) {
    region.firstElementChild?.remove();
  }
  while (queue.length && region.children.length < MAX_VISIBLE) {
    region.appendChild(queue.shift());
  }
}

function dismissToast(toast) {
  toast?.remove();
  flushToasts();
}
