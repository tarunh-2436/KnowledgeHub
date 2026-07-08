import { CONFIG } from "./config.js";
import { auth } from "./auth.js";

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, details = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class ApiClient {
  async request(path, options = {}) {
    const token = await auth.getAccessToken();
    if (!token) {
      throw new ApiError("Your session has expired. Please sign in again.", { status: 401 });
    }

    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response;
    try {
      response = await fetch(`${CONFIG.apiEndpoint}${path}`, {
        ...options,
        headers,
        body:
          options.body && typeof options.body !== "string"
            ? JSON.stringify(options.body)
            : options.body
      });
    } catch (error) {
      throw new ApiError("Network error. Check your connection and try again.", {
        status: 0,
        details: error
      });
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      const message =
        payload?.error?.message || friendlyStatusMessage(response.status) || "Request failed.";
      throw new ApiError(message, {
        status: response.status,
        code: payload?.error?.code,
        details: payload
      });
    }

    return payload?.data ?? {};
  }

  listDocuments() {
    return this.request("/documents");
  }

  async listSharedDocuments() {
    const shares = await this.request("/documents/shared");
    const enriched = await Promise.allSettled(
      shares.map(async (share) => ({
        ...(await this.getDocument(share.documentId)),
        shareRole: share.role,
        sharedAt: share.updatedAt || share.createdAt,
        share
      }))
    );

    return enriched.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : {
            ...shares[index],
            title: "Unavailable shared document",
            processingStatus: "UNKNOWN",
            unavailable: true
          }
    );
  }

  getDocument(documentId) {
    return this.request(`/documents/${encodeURIComponent(documentId)}`);
  }

  updateDocument(documentId, body) {
    return this.request(`/documents/${encodeURIComponent(documentId)}`, {
      method: "PATCH",
      body
    });
  }

  deleteDocument(documentId) {
    return this.request(`/documents/${encodeURIComponent(documentId)}`, {
      method: "DELETE"
    });
  }

  initDocumentUpload(body) {
    return this.request("/documents/init", {
      method: "POST",
      body
    });
  }

  completeDocumentUpload(body) {
    return this.request("/documents/complete", {
      method: "POST",
      body
    });
  }

  initVersionUpload(documentId, body) {
    return this.request(`/documents/${encodeURIComponent(documentId)}/versions/init`, {
      method: "POST",
      body
    });
  }

  completeVersionUpload(documentId, body) {
    return this.request(`/documents/${encodeURIComponent(documentId)}/versions/complete`, {
      method: "POST",
      body
    });
  }

  listVersions(documentId) {
    return this.request(`/documents/${encodeURIComponent(documentId)}/versions`);
  }

  getVersion(documentId, versionNumber) {
    return this.request(
      `/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionNumber)}`
    );
  }

  restoreVersion(documentId, versionNumber) {
    return this.request(
      `/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionNumber)}/restore`,
      { method: "POST" }
    );
  }

  listShares(documentId) {
    return this.request(`/documents/${encodeURIComponent(documentId)}/shares`);
  }

  shareDocument(documentId, body) {
    return this.request(`/documents/${encodeURIComponent(documentId)}/shares`, {
      method: "POST",
      body
    });
  }

  deleteShare(documentId, userId) {
    return this.request(
      `/documents/${encodeURIComponent(documentId)}/shares/${encodeURIComponent(userId)}`,
      { method: "DELETE" }
    );
  }

  getAdminStatistics() {
    return this.request("/admin/statistics");
  }

  getAdminDocuments() {
    return this.request("/admin/documents");
  }

  getAdminProcessing() {
    return this.request("/admin/processing");
  }

  uploadToPresignedUrl(uploadUrl, file, { contentType, onProgress } = {}) {
    let xhr;
    const promise = new Promise((resolve, reject) => {
      xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress?.(Math.round((event.loaded / event.total) * 100));
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(
            new ApiError("Direct S3 upload failed. Please retry the upload.", {
              status: xhr.status
            })
          );
        }
      });

      xhr.addEventListener("error", () =>
        reject(new ApiError("Network error during S3 upload.", { status: 0 }))
      );

      xhr.addEventListener("abort", () =>
        reject(new ApiError("Upload canceled.", { status: 0, code: "UPLOAD_ABORTED" }))
      );

      xhr.send(file);
    });

    return {
      promise,
      abort: () => xhr?.abort()
    };
  }
}

export const api = new ApiClient();

function friendlyStatusMessage(status) {
  return {
    400: "The request could not be processed. Check the form and try again.",
    401: "Your session has expired. Please sign in again.",
    403: "You do not have permission to perform this action.",
    404: "The requested resource was not found.",
    409: "This change conflicts with the latest server state.",
    500: "The service had an internal error. Please try again."
  }[status];
}
