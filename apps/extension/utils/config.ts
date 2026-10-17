export const config = {
  apiBase: import.meta.env.WXT_API_BASE,
  cognitoUserPoolId: import.meta.env.WXT_COGNITO_USER_POOL_ID,
  cognitoClientId: import.meta.env.WXT_COGNITO_CLIENT_ID,
  cloudFrontUrl: import.meta.env.WXT_CLOUDFRONT_URL,
} as const;