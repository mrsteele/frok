import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseVersion, updateReleaseTag} from '../scripts/release-version.mjs';
test('release versions must be semantic tags matching both package versions',()=>{
  assert.deepEqual(releaseVersion('v0.2.0','0.2.0','0.2.0'),{version:'0.2.0',prerelease:false});
  assert.equal(releaseVersion('v0.2.0-beta.1','0.2.0-beta.1','0.2.0-beta.1').prerelease,true);
  for(const tag of ['main','v01.0.0','v1.0','v1.0.0-beta.01','v1.0.0; touch bad'])assert.throws(()=>releaseVersion(tag,tag.slice(1),tag.slice(1)));
  assert.throws(()=>releaseVersion('v0.2.0','0.1.0','0.2.0'),/match/);
  assert.throws(()=>releaseVersion('v0.2.0','0.2.0','0.1.0'),/match/);
});

test('branch update signing uses an explicit tag without overriding GitHub reserved variables', () => {
  assert.equal(updateReleaseTag('0.1.1', { GITHUB_REF_NAME: 'candidate', FROK_RELEASE_TAG: 'v0.1.1' }), 'v0.1.1');
  assert.equal(updateReleaseTag('0.1.1', { GITHUB_REF_NAME: 'v0.1.1' }), 'v0.1.1');
  assert.equal(updateReleaseTag('0.1.1', {}), 'v0.1.1');
  assert.throws(() => updateReleaseTag('0.1.1', { GITHUB_REF_NAME: 'candidate' }));
  assert.throws(() => updateReleaseTag('0.1.1', { FROK_RELEASE_TAG: 'v0.1.0' }), /match/);
});
