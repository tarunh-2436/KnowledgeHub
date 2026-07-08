const rawConfig = window.KNOWLEDGEHUB_CONFIG || {};

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeConfig(config) {
  const awsRegion = config.awsRegion || config.region || "us-east-1";
  const cognitoDomain =
    config.cognitoDomain ||
    (config.cognitoDomainPrefix
      ? `${config.cognitoDomainPrefix}.auth.${awsRegion}.amazoncognito.com`
      : `tarun-knowledgehub-auth.auth.${awsRegion}.amazoncognito.com`);

  return {
    apiEndpoint: trimSlash(config.apiEndpoint),
    awsRegion,
    userPoolId: config.userPoolId || "",
    userPoolClientId: config.userPoolClientId || config.clientId || "",
    cognitoDomain: trimSlash(cognitoDomain),
    redirectUri: config.redirectUri || window.location.origin,
    logoutUri: config.logoutUri || window.location.origin,
    scopes: config.scopes || ["openid", "email", "profile"]
  };
}

export const CONFIG = normalizeConfig(rawConfig);

export function isConfigured() {
  return Boolean(
    CONFIG.apiEndpoint &&
      CONFIG.userPoolId &&
      CONFIG.userPoolClientId &&
      CONFIG.cognitoDomain
  );
}

export function getConfigStatus() {
  const missing = [];

  if (!CONFIG.apiEndpoint) missing.push("apiEndpoint");
  if (!CONFIG.userPoolId) missing.push("userPoolId");
  if (!CONFIG.userPoolClientId) missing.push("userPoolClientId");
  if (!CONFIG.cognitoDomain) missing.push("cognitoDomain");

  return {
    ready: missing.length === 0,
    missing
  };
}
