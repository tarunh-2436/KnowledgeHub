window.KNOWLEDGEHUB_CONFIG = {
  apiEndpoint: "${api_endpoint}",
  awsRegion: "${aws_region}",
  userPoolId: "${user_pool_id}",
  userPoolClientId: "${user_pool_client_id}",
  cognitoDomain: "tarun-knowledgehub-auth.auth.${aws_region}.amazoncognito.com",
  redirectUri: window.location.origin,
  logoutUri: window.location.origin
};
