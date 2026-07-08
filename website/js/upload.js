import { api } from "./api.js";
import { closeModal, openModal } from "./modal.js";
import { showToast } from "./toast.js";
import {
  escapeHtml,
  formatBytes,
  parseTags,
  resolveContentType,
  validateKnowledgeFile
} from "./utils.js";
import { icon } from "./components.js";

export function renderUploadView() {
  return `
    <div class="page-header">
      <div>
        <h2 class="page-title">Upload Document</h2>
        <p class="page-subtitle">Upload directly to Amazon S3 using a backend-generated presigned URL.</p>
      </div>
    </div>
    <div data-upload-root data-upload-mode="document">
      ${uploadMarkup()}
    </div>
  `;
}

export function openUploadDialog(app, document = null) {
  const node = document?.documentId ? documentUploadNode(document) : documentUploadNode(null);
  openModal({
    title: document?.documentId ? "Upload New Version" : "Upload Document",
    content: node,
    size: "wide"
  });
  mountUploadExperience(node, app, { document });
}

function documentUploadNode(document) {
  const wrapper = window.document.createElement("div");
  wrapper.dataset.uploadRoot = "";
  wrapper.dataset.uploadMode = document?.documentId ? "version" : "document";
  if (document?.documentId) {
    wrapper.dataset.documentId = document.documentId;
  }
  wrapper.innerHTML = uploadMarkup(document);
  return wrapper;
}

function uploadMarkup(document = null) {
  const isVersion = Boolean(document?.documentId);
  return `
    <section class="upload-panel">
      <div class="dropzone" data-upload-dropzone tabindex="0" role="button" aria-label="Choose a file to upload">
        <div>
          <div class="dropzone-icon">${icon("upload-cloud")}</div>
          <h3>${isVersion ? "Drop the replacement file here" : "Drop your document here"}</h3>
          <p>PDF, DOCX, TXT, and Markdown files are supported.</p>
          <div class="cluster" style="justify-content:center;margin-top:14px">
            <button class="btn btn-secondary" type="button" data-action="browse-file">${icon("file")}Browse</button>
          </div>
        </div>
        <input class="sr-only" type="file" data-upload-file accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/x-markdown" />
      </div>

      <div class="upload-form">
        <div class="selected-file hidden" data-selected-file></div>

        ${
          isVersion
            ? `<div class="panel">
                <strong>${escapeHtml(document.title || "Selected document")}</strong>
                <p class="muted mb-0">This upload will create a new version after ingestion completes.</p>
              </div>`
            : `<div class="field">
                <label for="upload-title">Title</label>
                <input id="upload-title" type="text" data-upload-title placeholder="Quarterly operating plan" required />
              </div>
              <div class="field">
                <label for="upload-tags">Tags</label>
                <input id="upload-tags" type="text" data-upload-tags placeholder="strategy, finance, planning" />
                <span class="field-help">Separate tags with commas.</span>
              </div>`
        }

        <div class="field">
          <label for="upload-notes">Version notes</label>
          <textarea id="upload-notes" data-upload-notes placeholder="What changed in this version?"></textarea>
        </div>

        <div class="stack hidden" data-upload-progress>
          <div class="cluster">
            <strong data-upload-status>Preparing upload</strong>
            <span class="subtle" data-upload-percent>0%</span>
          </div>
          <div class="progress" aria-hidden="true">
            <div class="progress-bar" data-upload-progress-bar></div>
          </div>
        </div>

        <div class="cluster">
          <button class="btn btn-primary" type="button" data-action="start-upload">${icon("upload-cloud")}${isVersion ? "Upload Version" : "Upload Document"}</button>
          <button class="btn btn-secondary hidden" type="button" data-action="cancel-upload">Cancel Upload</button>
          <button class="btn btn-secondary hidden" type="button" data-action="retry-upload">${icon("refresh")}Retry</button>
        </div>
      </div>
    </section>
  `;
}

export function mountUploadExperience(root, app, options = {}) {
  const dropzone = root.querySelector("[data-upload-dropzone]");
  const fileInput = root.querySelector("[data-upload-file]");
  const selectedFile = root.querySelector("[data-selected-file]");
  const titleInput = root.querySelector("[data-upload-title]");
  const tagsInput = root.querySelector("[data-upload-tags]");
  const notesInput = root.querySelector("[data-upload-notes]");
  const progress = root.querySelector("[data-upload-progress]");
  const progressBar = root.querySelector("[data-upload-progress-bar]");
  const statusText = root.querySelector("[data-upload-status]");
  const percentText = root.querySelector("[data-upload-percent]");
  const submitButton = root.querySelector('[data-action="start-upload"]');
  const cancelButton = root.querySelector('[data-action="cancel-upload"]');
  const retryButton = root.querySelector('[data-action="retry-upload"]');

  const mode = root.dataset.uploadMode || (options.document ? "version" : "document");
  const document = options.document || null;
  let file = null;
  let currentUpload = null;
  let busy = false;

  const setProgress = (percent, label) => {
    progress.classList.remove("hidden");
    progressBar.style.setProperty("--progress", `${percent}%`);
    percentText.textContent = `${percent}%`;
    statusText.textContent = label;
  };

  const resetControls = () => {
    busy = false;
    currentUpload = null;
    submitButton.disabled = false;
    cancelButton.classList.add("hidden");
  };

  const setFile = (nextFile) => {
    file = nextFile;
    const validation = validateKnowledgeFile(file);
    selectedFile.classList.remove("hidden");
    selectedFile.innerHTML = `
      <div class="file-icon">${icon("file-text")}</div>
      <div>
        <strong>${escapeHtml(file?.name || "No file selected")}</strong>
        <span>${file ? formatBytes(file.size) : ""}</span>
        ${validation.ok ? "" : `<p class="mb-0" style="color:var(--danger)">${escapeHtml(validation.message)}</p>`}
      </div>
      <button class="icon-btn" type="button" data-action="clear-file" aria-label="Clear selected file">${icon("x")}</button>
    `;

    if (titleInput && file && !titleInput.value.trim()) {
      titleInput.value = file.name.replace(/\.[^.]+$/, "");
    }
  };

  dropzone.addEventListener("click", (event) => {
    if (!event.target.closest("button")) fileInput.click();
  });

  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "browse-file") fileInput.click();
    if (action === "clear-file" && !busy) {
      file = null;
      fileInput.value = "";
      selectedFile.classList.add("hidden");
    }
    if (action === "start-upload") startUpload();
    if (action === "retry-upload") startUpload();
    if (action === "cancel-upload") currentUpload?.abort();
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files?.[0]) setFile(fileInput.files[0]);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    });
  });

  dropzone.addEventListener("drop", (event) => {
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) setFile(dropped);
  });

  async function startUpload() {
    if (busy) return;
    retryButton.classList.add("hidden");

    const validation = validateKnowledgeFile(file);
    if (!validation.ok) {
      showToast("warning", "Upload needs attention", validation.message);
      return;
    }

    const title = titleInput?.value.trim();
    if (mode === "document" && !title) {
      showToast("warning", "Title required", "Add a title before uploading the document.");
      titleInput?.focus();
      return;
    }

    busy = true;
    submitButton.disabled = true;
    cancelButton.classList.remove("hidden");

    try {
      setProgress(8, "Requesting upload session");
      const contentType = validation.contentType || resolveContentType(file);
      const initPayload = { filename: file.name, contentType };
      const uploadSession =
        mode === "version"
          ? await api.initVersionUpload(document.documentId, initPayload)
          : await api.initDocumentUpload(initPayload);

      setProgress(16, `Uploading ${file.name} - ${formatBytes(file.size)}`);
      currentUpload = api.uploadToPresignedUrl(uploadSession.uploadUrl, file, {
        contentType,
        onProgress: (percent) => setProgress(Math.max(18, Math.min(94, percent)), "Uploading to S3")
      });
      await currentUpload.promise;

      setProgress(96, "Completing upload");
      if (mode === "version") {
        await api.completeVersionUpload(document.documentId, {
          uploadId: uploadSession.uploadId,
          filename: file.name,
          versionNotes: notesInput.value.trim()
        });
      } else {
        await api.completeDocumentUpload({
          documentId: uploadSession.documentId,
          uploadId: uploadSession.uploadId,
          filename: file.name,
          title,
          tags: parseTags(tagsInput.value),
          versionNotes: notesInput.value.trim()
        });
      }

      setProgress(100, "Processing started");
      showToast(
        "success",
        mode === "version" ? "Version upload complete" : "Upload complete",
        "Processing has started. The dashboard will update as status changes."
      );

      await app.refreshData({ quiet: true });
      app.render();
      app.pollDocument(mode === "version" ? document.documentId : uploadSession.documentId);
      resetControls();
      if (root.closest(".modal")) closeModal();
    } catch (error) {
      resetControls();
      retryButton.classList.remove("hidden");
      showToast(
        error.code === "UPLOAD_ABORTED" ? "info" : "error",
        error.code === "UPLOAD_ABORTED" ? "Upload canceled" : "Upload failed",
        error.message || "The upload could not be completed."
      );
    }
  }
}
