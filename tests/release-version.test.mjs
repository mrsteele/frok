import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseVersion} from '../scripts/release-version.mjs';
test('release versions must be semantic tags matching both package versions',()=>{
  assert.deepEqual(releaseVersion('v0.2.0','0.2.0','0.2.0'),{version:'0.2.0',prerelease:false});
  assert.equal(releaseVersion('v0.2.0-beta.1','0.2.0-beta.1','0.2.0-beta.1').prerelease,true);
  for(const tag of ['main','v01.0.0','v1.0','v1.0.0-beta.01','v1.0.0; touch bad'])assert.throws(()=>releaseVersion(tag,tag.slice(1),tag.slice(1)));
  assert.throws(()=>releaseVersion('v0.2.0','0.1.0','0.2.0'),/match/);
  assert.throws(()=>releaseVersion('v0.2.0','0.2.0','0.1.0'),/match/);
});
