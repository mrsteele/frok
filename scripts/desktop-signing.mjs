export function signingConfiguration(base, env=process.env, platform=process.platform) {
  const config=structuredClone(base);
  if(env.FROK_SIGN_RELEASE!=='1')return config;
  if(platform!=='darwin')throw Error('FROK_SIGN_RELEASE currently supports macOS builds only.');
  const required=['CSC_LINK','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID'];
  const missing=required.filter(key=>!env[key]?.trim());
  if(missing.length)throw Error(`Release signing requires ${missing.join(', ')}. Configure these as CI secrets; unsigned fallback is disabled.`);
  config.forceCodeSigning=true;
  config.mac={...config.mac,hardenedRuntime:true,notarize:true,entitlements:'desktop/entitlements.mac.plist',entitlementsInherit:'desktop/entitlements.mac.plist'};
  delete config.mac.identity; // Let electron-builder select the imported Developer ID certificate.
  return config;
}
