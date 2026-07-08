export const STORAGE_KEYS = {
  theme: "knowledgehub.theme",
  session: "knowledgehub.session",
  codeVerifier: "knowledgehub.oauth.codeVerifier",
  oauthState: "knowledgehub.oauth.state",
  returnTo: "knowledgehub.oauth.returnTo",
  recentSearches: "knowledgehub.recentSearches"
};

export const SUPPORTED_FILE_TYPES = {
  ".pdf": ["application/pdf"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ],
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/plain", "text/x-markdown"]
};

const DEFAULT_CONTENT_TYPES = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown"
};

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

export function debounce(fn, wait = 250) {
  let timeoutId;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), wait);
  };
}

export function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function getFileExtension(filename = "") {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

export function resolveContentType(file) {
  const extension = getFileExtension(file?.name);
  return file?.type || DEFAULT_CONTENT_TYPES[extension] || "application/octet-stream";
}

export function validateKnowledgeFile(file) {
  if (!file) {
    return { ok: false, message: "Select a file to upload." };
  }

  if (file.size === 0) {
    return { ok: false, message: "The selected file is empty." };
  }

  const extension = getFileExtension(file.name);
  const allowedTypes = SUPPORTED_FILE_TYPES[extension];

  if (!allowedTypes) {
    return {
      ok: false,
      message: "Supported files are PDF, DOCX, TXT, and Markdown."
    };
  }

  const contentType = resolveContentType(file);

  if (!allowedTypes.includes(contentType)) {
    return {
      ok: false,
      message: `The file content type ${contentType} is not valid for ${extension}.`
    };
  }

  return { ok: true, contentType, extension };
}

export function parseTags(value) {
  const seen = new Set();
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function formatDate(value, options = {}) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: options.dateStyle || "medium",
    timeStyle: options.timeStyle || "short"
  }).format(date);
}

export function relativeTime(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";

  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units = [
    ["year", 31536000000],
    ["month", 2592000000],
    ["week", 604800000],
    ["day", 86400000],
    ["hour", 3600000],
    ["minute", 60000]
  ];

  for (const [unit, ms] of units) {
    if (abs >= ms) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
        Math.round(diff / ms),
        unit
      );
    }
  }

  return "just now";
}

export function formatBytes(bytes = 0) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function decodeJwt(token) {
  if (!token || !token.includes(".")) return null;
  try {
    const payload = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const json = decodeURIComponent(
      Array.from(atob(payload), (char) =>
        `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`
      ).join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function isJwtExpired(token, skewSeconds = 60) {
  const claims = decodeJwt(token);
  if (!claims?.exp) return true;
  return claims.exp * 1000 <= Date.now() + skewSeconds * 1000;
}

export function getUserInitials(user) {
  const source = user?.email || user?.username || user?.sub || "KH";
  const parts = String(source).split(/[@.\s_-]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function normalizeRole(role) {
  return String(role || "VIEWER").toUpperCase();
}

export function normalizeStatus(status) {
  return String(status || "UNKNOWN").toUpperCase();
}

export function highlight(text, query) {
  const safe = escapeHtml(text || "");
  const q = String(query || "").trim();
  if (!q) return safe;

  const pattern = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(pattern, "gi"), (match) => `<mark>${match}</mark>`);
}

export function saveRecentSearch(query) {
  const value = String(query || "").trim();
  if (!value) return;
  const current = loadRecentSearches().filter(
    (item) => item.toLowerCase() !== value.toLowerCase()
  );
  localStorage.setItem(
    STORAGE_KEYS.recentSearches,
    JSON.stringify([value, ...current].slice(0, 8))
  );
}

export function loadRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.recentSearches) || "[]");
  } catch {
    return [];
  }
}

export function sortByUpdatedAt(items) {
  return [...toArray(items)].sort(
    (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
  );
}

export function createEvent(name, detail = {}) {
  return new CustomEvent(name, { detail, bubbles: true });
}

export function randomString(length = 64) {
  const charset =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => charset[byte % charset.length]).join("");
}

export function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function sha256(value) {
  const encoded = new TextEncoder().encode(value);
  return crypto.subtle.digest("SHA-256", encoded);
}
