import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signingConfiguration } from '../scripts/desktop-signing.mjs';

const base={publish:null,mac:{identity:null,hardenedRuntime:false,notarize:false}};
test('local packaging remains unsigned and does not use incidental credentials',()=>{
  assert.deepEqual(signingConfiguration(base,{CSC_LINK:'synthetic'},'darwin'),base);
});
test('release signing fails closed when credentials or the target platform are missing',()=>{
  assert.throws(()=>signingConfiguration(base,{FROK_SIGN_RELEASE:'1'},'darwin'),/requires CSC_LINK/);
  assert.throws(()=>signingConfiguration(base,{FROK_SIGN_RELEASE:'1'},'linux'),/macOS/);
});
test('signed packaging requires notarization without putting secrets in the generated config',()=>{
  const env={FROK_SIGN_RELEASE:'1',CSC_LINK:'synthetic-certificate',APPLE_ID:'synthetic-account',APPLE_APP_SPECIFIC_PASSWORD:'synthetic-password',APPLE_TEAM_ID:'synthetic-team'};
  const result=signingConfiguration(base,env,'darwin');
  assert.equal(result.forceCodeSigning,true);assert.equal(result.mac.identity,undefined);
  assert.equal(result.mac.hardenedRuntime,true);assert.equal(result.mac.notarize,true);
  assert.doesNotMatch(JSON.stringify(result),/synthetic-/);
  assert.equal(base.mac.identity,null);assert.equal(base.mac.hardenedRuntime,false);
});
