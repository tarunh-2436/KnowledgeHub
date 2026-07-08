export const store = {
  user: null,
  currentRoute: "dashboard",
  routeParams: {},
  documents: [],
  sharedDocuments: [],
  adminStats: null,
  adminDocuments: [],
  adminProcessing: { processing: [], failed: [] },
  loading: false,
  loadedAt: null
};

export function setState(patch) {
  Object.assign(store, patch);
  window.dispatchEvent(new CustomEvent("knowledgehub:state", { detail: patch }));
}
