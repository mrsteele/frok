// Launch with the local Electron binary after build:docs:desktop. No studio,
// worker, user workspace, model runner or external browser is started.
import { app, BrowserWindow, protocol } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createDocumentation } from '../desktop/docs-window.mjs';

protocol.registerSchemesAsPrivileged([{ scheme:'frok-docs', privileges:{ standard:true, secure:true, supportFetchAPI:true, corsEnabled:true, stream:true } }]);
const profile = mkdtempSync(path.join(os.tmpdir(), 'frok-docs-smoke-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
async function smoke() {
const timer = setTimeout(() => { console.error('Documentation smoke check timed out.'); app.exit(1); }, 60000);
let result = 0;
try {
  await app.whenReady();
  const docs = createDocumentation({ root:path.resolve('.desktop/docs'), preload:path.resolve('desktop/docs-preload.cjs') });
  await docs.open('/guide/getting-started');
  const window = BrowserWindow.getAllWindows()[0];
  async function waitFor(expression, timeoutMs=5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const mediaState = await window.webContents.executeJavaScript("(() => { const demo = document.querySelector('.workflow-demo'), video = demo?.querySelector('video'); return { hidden: document.hidden, stage: demo?.dataset.stage, className: demo?.className, video: video && { src: video.currentSrc, paused: video.paused, time: video.currentTime, readyState: video.readyState, networkState: video.networkState, error: video.error?.message } }; })()");
    throw Error(`Documentation assertion timed out: ${expression}\n${JSON.stringify(mediaState)}`);
  }
  await waitFor("document.body.innerText.includes('Offline documentation')");
  assert.ok(await window.webContents.executeJavaScript("(() => { const notice = document.querySelector('.desktop-docs-notice'); const rect = notice.getBoundingClientRect(); return notice.contains(document.elementFromPoint(rect.left + 30, rect.top + 15)); })()"));
  assert.equal(await window.webContents.executeJavaScript('typeof window.frokDesktop'), 'undefined');
  assert.equal(await window.webContents.executeJavaScript('window.frokDocs.info().then(info => info.onlineAvailable)'), false);
  assert.ok(await window.webContents.executeJavaScript('document.styleSheets.length > 0'));
  assert.equal(await window.webContents.executeJavaScript("fetch('http://127.0.0.1:3440/api/jobs').then(() => false, () => true)"), true);
  // Exercise the actual VitePress client router and generated search index.
  await window.webContents.executeJavaScript("document.querySelector('a[href=\"/pipelines.html\"]').click()");
  await waitFor("location.pathname === '/pipelines.html' && document.querySelector('h1')?.textContent.includes('Pipeline')");
  await window.webContents.executeJavaScript("document.querySelector('.VPNavBarSearch button').click()");
  await waitFor("!!document.querySelector('#localsearch-input')");
  await window.webContents.executeJavaScript("{ const input = document.querySelector('#localsearch-input'); input.value = 'queue'; input.dispatchEvent(new Event('input', { bubbles:true })); }");
  await waitFor("document.querySelectorAll('.VPLocalSearchBox .result').length > 0");
  await docs.open('/examples/krea');
  const download = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Example download was not initiated')), 5000);
    window.webContents.session.once('will-download', (event, item) => {
      event.preventDefault(); clearTimeout(timeout); resolve(item.getFilename());
    });
  });
  await window.webContents.executeJavaScript("document.querySelector('a[download]').click()");
  assert.match(await download, /\.(vpipeline|json)$/);
  await docs.open('/guide/getting-started#_2-connect-a-service');
  await waitFor("document.body.innerText.includes('Offline documentation')");
  assert.ok(window.webContents.getURL().endsWith('#_2-connect-a-service'));
  await waitFor("!!document.getElementById('_2-connect-a-service')");
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  if (process.env.FROK_DOCS_SCREENSHOT === '1') await fs.writeFile(path.resolve('.desktop/docs-smoke.png'), (await window.webContents.capturePage()).toPNG());
  await docs.open('/');
  await waitFor("!!document.querySelector('.workflow-demo')");
  assert.equal(await window.webContents.executeJavaScript("document.querySelector('.workflow-demo video').controls"), false);
  assert.equal(await window.webContents.executeJavaScript("getComputedStyle(document.querySelector('.workflow-demo')).pointerEvents"), 'none');
  assert.equal(await window.webContents.executeJavaScript("fetch('/demo/sailboat.mp4', { headers: { Range: 'bytes=0-15' } }).then(response => response.status)"), 206);
  if (await window.webContents.executeJavaScript("matchMedia('(prefers-reduced-motion: reduce)').matches")) {
    await waitFor("document.querySelector('.workflow-demo').dataset.stage === '3'");
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('.workflow-demo video').getAttribute('src')"), null);
  } else {
    await waitFor("(() => { const video = document.querySelector('.workflow-demo video'); return !video.paused && video.currentTime > 0.1; })()", 35000);
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('.workflow-demo video').error"), null);
  }
  console.log('Offline Electron docs passed: navigation, CSS, local search, example download, anchors, isolated bridge, blocked network access and homepage video playback (or reduced-motion still). No generators ran.');
} catch (error) { console.error(error); result = 1; }
finally {
  clearTimeout(timer);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await fs.rm(profile, { recursive:true, force:true, maxRetries:3, retryDelay:100 });
  app.exit(result);
}
}
void smoke();
