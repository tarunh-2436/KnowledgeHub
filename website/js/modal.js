import { escapeHtml } from "./utils.js";
import { icon } from "./components.js";

let root;
let activeModal = null;
let lastFocused = null;

export function initModals(documentRoot = document) {
  root = documentRoot.querySelector("[data-modal-root]");
  document.addEventListener("keydown", handleKeydown);
}

export function openModal({
  title,
  content,
  footer = "",
  size = "",
  onClose,
} = {}) {
  if (!root) initModals();
  closeModal();

  lastFocused = document.activeElement;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <section class="modal ${size === "wide" ? "modal-wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header class="modal-header">
        <h2 class="modal-title" id="modal-title">${escapeHtml(title || "")}</h2>
        <button class="icon-btn" type="button" data-modal-close aria-label="Close dialog">${icon("x")}</button>
      </header>
      <div class="modal-body" data-modal-body></div>
      <footer class="modal-footer" data-modal-footer></footer>
    </section>
  `;

  const body = backdrop.querySelector("[data-modal-body]");
  const footerNode = backdrop.querySelector("[data-modal-footer]");
  if (content instanceof Node) {
    body.appendChild(content);
  } else {
    body.innerHTML = content || "";
  }
  if (footer instanceof Node) {
    footerNode.appendChild(footer);
  } else {
    footerNode.innerHTML = footer || "";
  }
  if (!footerNode.textContent.trim() && footerNode.children.length === 0) {
    footerNode.remove();
  }

  backdrop.addEventListener("click", (event) => {
    if (
      event.target === backdrop ||
      event.target.closest("[data-modal-close]")
    ) {
      closeModal();
    }
  });

  activeModal = { backdrop, onClose };
  root.appendChild(backdrop);
  focusFirst(backdrop);
  return backdrop;
}

export function closeModal() {
  if (!activeModal) return;
  const { backdrop, onClose } = activeModal;
  backdrop.remove();
  activeModal = null;
  onClose?.();
  if (lastFocused && document.contains(lastFocused)) {
    lastFocused.focus();
  }
}

export function confirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
}) {
  return new Promise((resolve) => {
    openModal({
      title,
      content: `<p class="muted mt-0">${escapeHtml(message)}</p>`,
      footer: `
        <button class="btn btn-secondary" type="button" data-modal-cancel>${escapeHtml(cancelLabel)}</button>
        <button class="btn ${tone === "danger" ? "btn-danger" : "btn-primary"}" type="button" data-modal-confirm>${escapeHtml(confirmLabel)}</button>
      `,
      onClose: () => resolve(false),
    });

    root.querySelector("[data-modal-cancel]")?.addEventListener("click", () => {
      closeModal();
      resolve(false);
    });
    root
      .querySelector("[data-modal-confirm]")
      ?.addEventListener("click", () => {
        const modal = activeModal;
        activeModal = null;
        modal?.backdrop.remove();
        if (modal) {
          modal.onClose = null;
        }
        resolve(true);
      });
  });
}


function handleKeydown(event) {
  if (!activeModal) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeModal();
  }

  if (event.key === "Tab") {
    trapFocus(event);
  }
}

function focusFirst(container) {
  const focusable = getFocusable(container);
  (focusable[0] || container.querySelector(".modal")).focus?.();
}

function trapFocus(event) {
  const focusable = getFocusable(activeModal.backdrop);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function getFocusable(container) {
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}
