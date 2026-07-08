import { CONFIG, getConfigStatus } from "./config.js";
import {
  STORAGE_KEYS,
  base64UrlEncode,
  decodeJwt,
  isJwtExpired,
  randomString,
  sha256
} from "./utils.js";

class AuthService extends EventTarget {
  constructor() {
    super();
    this.session = null;
    this.user = null;
  }

  async init() {
    this.session = this.loadSession();
    this.user = this.buildUser();

    const params = new URLSearchParams(window.location.search);
    if (params.has("error")) {
      const message = params.get("error_description") || params.get("error") || "Sign-in failed.";
      this.cleanUrl();
      throw new Error(message);
    }

    if (params.has("code")) {
      await this.handleRedirect(params);
    } else if (this.session?.refreshToken && isJwtExpired(this.session.accessToken)) {
      await this.refreshSession().catch(() => this.clearSession());
    }

    this.user = this.buildUser();
    this.dispatchEvent(new CustomEvent("authchange", { detail: { user: this.user } }));
    return this.user;
  }

  isAuthenticated() {
    return Boolean(this.session?.accessToken && !isJwtExpired(this.session.accessToken, 0));
  }

  isAdmin() {
    return Boolean(this.user?.isAdmin);
  }

  async login(returnTo = window.location.hash || "#dashboard") {
    const status = getConfigStatus();
    if (!status.ready) {
      throw new Error(`Frontend configuration is missing: ${status.missing.join(", ")}`);
    }

    const verifier = randomString(96);
    const challenge = base64UrlEncode(await sha256(verifier));
    const state = randomString(24);

    sessionStorage.setItem(STORAGE_KEYS.codeVerifier, verifier);
    sessionStorage.setItem(STORAGE_KEYS.oauthState, state);
    sessionStorage.setItem(STORAGE_KEYS.returnTo, returnTo);

    const url = new URL(`https://${CONFIG.cognitoDomain}/oauth2/authorize`);
    url.searchParams.set("client_id", CONFIG.userPoolClientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", CONFIG.scopes.join(" "));
    url.searchParams.set("redirect_uri", CONFIG.redirectUri);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("state", state);

    window.location.assign(url.toString());
  }

  logout() {
    this.clearSession();
    const status = getConfigStatus();
    if (!status.ready) {
      window.location.hash = "#dashboard";
      return;
    }

    const url = new URL(`https://${CONFIG.cognitoDomain}/logout`);
    url.searchParams.set("client_id", CONFIG.userPoolClientId);
    url.searchParams.set("logout_uri", CONFIG.logoutUri);
    window.location.assign(url.toString());
  }

  async getAccessToken() {
    if (!this.session?.accessToken) return null;
    if (isJwtExpired(this.session.accessToken) && this.session.refreshToken) {
      await this.refreshSession();
    }
    return this.session?.accessToken || null;
  }

  async handleRedirect(params) {
    const code = params.get("code");
    const state = params.get("state");
    const expectedState = sessionStorage.getItem(STORAGE_KEYS.oauthState);
    const verifier = sessionStorage.getItem(STORAGE_KEYS.codeVerifier);

    if (!code || !verifier || state !== expectedState) {
      this.cleanUrl();
      throw new Error("The sign-in response could not be verified.");
    }

    const token = await this.requestToken({
      grant_type: "authorization_code",
      client_id: CONFIG.userPoolClientId,
      code,
      redirect_uri: CONFIG.redirectUri,
      code_verifier: verifier
    });

    this.saveSession(token);
    const returnTo = sessionStorage.getItem(STORAGE_KEYS.returnTo) || "#dashboard";
    sessionStorage.removeItem(STORAGE_KEYS.codeVerifier);
    sessionStorage.removeItem(STORAGE_KEYS.oauthState);
    sessionStorage.removeItem(STORAGE_KEYS.returnTo);
    this.cleanUrl(returnTo);
  }

  async refreshSession() {
    if (!this.session?.refreshToken) {
      throw new Error("No refresh token is available.");
    }

    const token = await this.requestToken({
      grant_type: "refresh_token",
      client_id: CONFIG.userPoolClientId,
      refresh_token: this.session.refreshToken
    });

    this.saveSession({
      ...token,
      refresh_token: token.refresh_token || this.session.refreshToken
    });

    this.user = this.buildUser();
    this.dispatchEvent(new CustomEvent("authchange", { detail: { user: this.user } }));
    return this.session;
  }

  async requestToken(params) {
    const response = await fetch(`https://${CONFIG.cognitoDomain}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(params)
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error_description || payload.error || "Unable to complete sign-in.");
    }
    return payload;
  }

  saveSession(token) {
    const now = Date.now();
    this.session = {
      accessToken: token.access_token,
      idToken: token.id_token,
      refreshToken: token.refresh_token,
      tokenType: token.token_type || "Bearer",
      expiresAt: now + Number(token.expires_in || 3600) * 1000
    };
    localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(this.session));
  }

  loadSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.session) || "null");
    } catch {
      return null;
    }
  }

  clearSession() {
    this.session = null;
    this.user = null;
    localStorage.removeItem(STORAGE_KEYS.session);
    this.dispatchEvent(new CustomEvent("authchange", { detail: { user: null } }));
  }

  buildUser() {
    if (!this.session?.accessToken && !this.session?.idToken) return null;
    const idClaims = decodeJwt(this.session.idToken) || {};
    const accessClaims = decodeJwt(this.session.accessToken) || {};
    const groups = [
      ...(Array.isArray(idClaims["cognito:groups"]) ? idClaims["cognito:groups"] : []),
      ...(Array.isArray(accessClaims["cognito:groups"]) ? accessClaims["cognito:groups"] : [])
    ];

    return {
      sub: idClaims.sub || accessClaims.sub,
      email: idClaims.email || accessClaims.email || accessClaims.username || "Signed in",
      username: accessClaims.username || idClaims["cognito:username"],
      groups,
      isAdmin: groups.includes("admins")
    };
  }

  cleanUrl(hash = window.location.hash || "#dashboard") {
    const next = `${window.location.pathname}${hash}`;
    window.history.replaceState({}, document.title, next);
  }
}

export const auth = new AuthService();
