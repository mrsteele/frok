import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startUIGallery } from './ui-gallery.mjs';

// Isolated fixture app: no Frok library, runner, download or inference is started.
const profile = mkdtempSync(path.join(os.tmpdir(), 'frok-studio-ux-'));
const assetPath = '/asset/22222222-2222-4222-8222-222222222222';
const screenshots = path.resolve('.data/ux-checks');
app.setPath('userData', profile);
app.on('window-all-closed', () => {});

async function smoke() {
  const timeout = setTimeout(() => {
    console.error('Whole-app UX checks timed out.');
    app.exit(1);
  }, 120000);
  let gallery, window, code = 0;
  const errors = [];
  try {
    await app.whenReady();
    gallery = await startUIGallery({ port: 0, watch: false });
    await fs.mkdir(screenshots, { recursive: true });
    window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !details.url.startsWith(gallery.url + '/') && !/^(data|blob):/.test(details.url) });
    });
    window.webContents.on('console-message', event => {
      if (event.level === 'error') errors.push(event.message);
    });
    const js = expression => window.webContents.executeJavaScript(expression);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function wait(expression) {
      for (let i = 0; i < 150; i++) {
        if (await js(expression)) return;
        await pause(40);
      }
      throw Error(`Timed out: ${expression}\n${errors.join('\n')}`);
    }
    async function load(route = '/', state = 'connected') {
      await window.loadURL(`${gallery.url}${route}?view=studio&state=${state}`);
      await wait("!!document.querySelector('.studio') && window.__uiCalls.some(call=>call.url==='/api/health')");
      if (route.startsWith('/asset/')) await wait("!!document.querySelector('#viewer-motion-prompt')");
      else if (route === '/' && ['empty', 'disconnected', 'offline'].includes(state)) await wait("!!document.querySelector('.landing')");
      else if (route === '/') await wait("!!document.querySelector('.media-card')");
      else if (route === '/settings/welcome') await wait("!!document.querySelector('.setup-wizard[open]')");
      else if (route === '/settings/recipes') await wait("!!document.querySelector('.preset-list')");
      else if (route === '/settings/advanced') await wait("!!document.querySelector('#api-tokens input')");
      else if (route.startsWith('/settings')) await wait("!!document.querySelector('.settings-page')");
      else if (route === '/queue' && state === 'empty') await wait("!!document.querySelector('.queue-empty')");
      else if (route.startsWith('/queue')) await wait("!!document.querySelector('.job-row')");
      await js('document.fonts.ready');
      await pause(150);
    }
    async function shot(name) {
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await fs.writeFile(path.join(screenshots, name + '.png'), (await window.webContents.capturePage()).toPNG());
    }
    async function noOverflow(label) {
      assert.equal(await js('document.documentElement.scrollWidth <= innerWidth + 1'), true, label + ': page overflow');
      const overflow = await js(`Array.from(document.querySelectorAll('.composer,.composer-controls,.viewer-composer,.viewer-generation-footer,.job-row,.wizard-summary,.ui-form-actions,.workflow-picker'))
        .filter(el=>el.getClientRects().length && el.scrollWidth>el.clientWidth+2).map(el=>el.className)`);
      assert.deepEqual(overflow, [], label + ': component overflow');
    }
    async function navigationLabels(label) {
      const links = await js(`Array.from(document.querySelectorAll('.sidebar nav a')).map(el=>({
        text:el.querySelector('span:not(.settings-badge)')?.textContent,
        visible:!!el.querySelector('span:not(.settings-badge)')?.getClientRects().length,
      }))`);
      assert.ok(links.length >= 4, label + ': navigation destinations');
      assert.ok(links.every(link => link.text && link.visible), label + ': visible navigation labels');
      assert.equal(links[0].text, 'Create');
    }
    const posts = () => js("window.__uiCalls.filter(call=>call.url==='/api/jobs' && call.method==='POST').length");
    const clickText = (scope, text) => js(`(()=>{const button=Array.from(document.querySelectorAll(${JSON.stringify(scope)})).find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing action: '+${JSON.stringify(text)});button.focus();button.click();})()`);
    function key(keyCode, modifiers = []) {
      window.webContents.focus();
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      if (keyCode === 'Enter' && modifiers.length === 0)
        window.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    }

    const screens = [
      ['create-empty', '/', 'empty'],
      ['create-history', '/', 'connected'],
      ['create-disconnected', '/', 'disconnected'],
      ['asset', assetPath, 'connected'],
      ['favorites-empty', '/favorites', 'empty'],
      ['queue-empty', '/queue', 'empty'],
      ['queue-busy', '/queue', 'busy'],
      ['queue-error', '/queue', 'error'],
      ['services', '/settings', 'connected'],
      ['workflows', '/settings/generation', 'connected'],
      ['recipes', '/settings/recipes', 'connected'],
      ['advanced', '/settings/advanced', 'connected'],
    ];
    for (const width of [420, 800, 1280]) {
      window.setContentSize(width, 900);
      for (const [name, route, state] of screens) {
        await load(route, state);
        await noOverflow(`${name} ${width}`);
        await navigationLabels(`${name} ${width}`);
        assert.equal(await posts(), 0, 'browsing never starts generation');
        await shot(`${name}-${width}`);
        if (name === 'asset') {
          await js("document.querySelector('.viewer-composer').scrollIntoView({block:'center'})");
          await shot(`asset-editor-${width}`);
        }
      }
    }
    window.webContents.setZoomFactor(2);
    for (const [name, route, state] of screens.filter(([name]) => ['create-empty', 'asset', 'queue-busy', 'workflows'].includes(name))) {
      await load(route, state);
      await noOverflow(name + ' 200% zoom');
      await navigationLabels(name + ' 200% zoom');
      if (name === 'asset') await js("document.querySelector('.viewer-composer').scrollIntoView({block:'center'})");
      await shot(name + '-zoom');
    }
    window.webContents.setZoomFactor(1);
    window.setContentSize(1280, 900);

    await load('/');
    assert.equal(await js("document.querySelector('.create-button').textContent.trim()"), 'Generate');
    assert.equal(await js("document.querySelector('select[aria-label=\"Generation mode\"] option[value=reference]').textContent"), 'Reference video');
    assert.match(await js("document.querySelector('.prompt-section .load-more button').textContent"), /Generate (?:\d+ )?more/);
    await js("(()=>{const prompt=document.querySelector('#prompt');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(prompt,'Keep this image draft');prompt.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await wait("document.querySelector('#prompt').value==='Keep this image draft'");
    await js("document.querySelector('.animate-button').focus()");
    await shot('quick-video-idle-1280');
    key('Enter');
    await wait("document.querySelector('.animate-button')?.textContent.includes('Queuing')");
    assert.equal(await js("document.querySelector('.animate-button').disabled"), true, 'quick video disables while submitting');
    assert.equal(await js("document.querySelector('.create-button').textContent.trim()"), 'Generate', 'quick video does not imply the separate composer draft was submitted');
    await js("document.querySelector('.animate-button').click()");
    await shot('quick-video-queuing-1280');
    await wait("document.querySelector('.animate-button')?.textContent.includes('View progress') && !document.querySelector('.animate-button').disabled");
    assert.equal(await posts(), 1, 'keyboard quick action and a duplicate click queue exactly one job');
    const quickRequest = await js("window.__uiCalls.find(call=>call.url==='/api/jobs' && call.method==='POST').body");
    assert.equal(quickRequest.mode, 'video');
    assert.equal(quickRequest.sourceId, assetPath.split('/').at(-1));
    assert.equal(quickRequest.count, 1);
    assert.equal(quickRequest.videoStyle, 'preset');
    assert.equal(quickRequest.videoPreset.id, 'normal', 'quick video snapshots the default recipe');
    assert.equal(quickRequest.prompt, '', 'quick video does not consume the composer draft');
    assert.equal(quickRequest.seed, undefined, 'quick video leaves the seed random');
    assert.equal(await js('location.pathname'), '/', 'quick video stays on Create');
    assert.equal(await js("document.querySelector('#prompt').value"), 'Keep this image draft');
    await shot('quick-video-queued-1280');
    await js("document.querySelector('.animate-button').click()");
    await wait("location.pathname.startsWith('/queue/')");
    assert.equal(await posts(), 1, 'viewing progress does not queue another video');

    await load('/settings/recipes');
    await js("document.querySelector('button[aria-label=\"Make Dance the default recipe\"]').click()");
    await wait("document.querySelector('button[aria-label=\"Dance is the default recipe\"]')?.disabled===false");
    await js("document.querySelector('.sidebar nav a[href=\"/\"]').click()");
    await wait("location.pathname==='/' && !!document.querySelector('.animate-button')");
    window.setContentSize(420, 900);
    await js("document.querySelector('.animate-button').focus()");
    await noOverflow('quick video 420');
    await shot('quick-video-idle-420');
    await js("document.querySelector('.animate-button').click()");
    await wait("document.querySelector('.animate-button')?.textContent.includes('View progress') && !document.querySelector('.animate-button').disabled");
    assert.equal(await posts(), 1, 'changed-default action queues once');
    assert.equal(await js("window.__uiCalls.find(call=>call.url==='/api/jobs' && call.method==='POST').body.videoPreset.id"), 'dance', 'quick action uses the current saved default');
    assert.equal(await js("document.querySelector('.media-card .video-progress-label').getBoundingClientRect().bottom <= document.querySelector('.animate-button').getBoundingClientRect().top"), true, 'compact progress status stays above its action');
    await shot('quick-video-queued-420');
    await js("document.querySelector('.media-open').style.aspectRatio='16 / 9'");
    assert.equal(await js("document.querySelector('.media-card .video-progress-label').getBoundingClientRect().bottom <= document.querySelector('.animate-button').getBoundingClientRect().top"), true, 'narrow landscape progress stays above its action');
    await shot('quick-video-queued-landscape-420');
    window.setContentSize(1280, 900);

    await load('/', 'missing');
    await js("document.querySelector('.animate-button').click()");
    await wait("location.pathname.startsWith('/settings')");
    assert.equal(await posts(), 0, 'missing video dependencies keep the existing setup guard');

    await load('/', 'error');
    await js("document.querySelector('.animate-button').click()");
    await wait("!!document.querySelector('.error-toast') && !document.querySelector('.animate-button').disabled");
    assert.match(await js("document.querySelector('.error-toast').textContent"), /Example failure/);
    assert.equal(await js('location.pathname'), '/', 'queue errors leave the image available for retry');
    assert.equal(await js("document.querySelector('.animate-button').textContent.trim()"), 'Generate video');

    await load('/');
    await js("document.querySelector('.media-open').click()");
    await wait("!!document.querySelector('#viewer-motion-prompt')");
    assert.equal(await js('location.pathname'), assetPath, 'the image itself opens the creation editor');
    assert.equal(await posts(), 0, 'opening an image does not queue a render');
    await js("document.querySelector('.viewer-recipes summary').click()");
    const recipeText = await js("(()=>{const button=Array.from(document.querySelectorAll('.viewer-recipes button')).find(el=>el.querySelector('small')?.textContent);return {name:button.querySelector('strong').textContent,prompt:button.querySelector('small').textContent};})()");
    await js("Array.from(document.querySelectorAll('.viewer-recipes button')).find(el=>el.querySelector('strong').textContent===" + JSON.stringify(recipeText.name) + ").click()");
    await wait("document.querySelector('#viewer-motion-prompt').value.length>0");
    assert.equal(await posts(), 0, 'choosing a recipe only updates the draft');
    assert.equal(await js("document.activeElement.id"), 'viewer-motion-prompt', 'recipe selection focuses the editable draft');
    window.setContentSize(420, 900);
    await js("document.querySelector('.viewer-composer').scrollIntoView({block:'center'})");
    await noOverflow('selected recipe 420');
    await shot('asset-selected-recipe-420');
    const draft = await js("document.querySelector('#viewer-motion-prompt').value");
    key('Enter');
    await pause(120);
    assert.equal(await posts(), 0, 'plain Enter does not queue generation');
    assert.ok((await js("document.querySelector('#viewer-motion-prompt').value")).includes('\n'), 'plain Enter inserts a newline');
    assert.ok(draft.length > 0, 'recipe draft is populated');
    key('Enter', [process.platform === 'darwin' ? 'meta' : 'control']);
    await wait("window.__uiCalls.some(call=>call.url==='/api/jobs' && call.method==='POST')");
    assert.equal(await posts(), 1, 'keyboard shortcut queues exactly one synthetic job');
    window.setContentSize(1280, 900);

    await load('/queue', 'empty');
    await clickText('.queue-empty a', 'Create something');
    await wait("location.pathname==='/' && !!document.querySelector('.composer')");
    await load('/queue', 'error');
    assert.match(await js("document.querySelector('.job-row.failed').textContent"), /connection was interrupted/);
    await js("document.querySelector('.job-row.failed .job-log-link').click()");
    await wait("!!document.querySelector('.job-log pre[aria-label=\"Runner output\"]')");
    assert.equal(await js("document.querySelector('.page-heading h1').textContent"), 'Job details & logs');
    await wait("document.querySelector('.job-log pre[aria-label=\"Runner output\"]').textContent.includes('Synthetic runner output')");
    await shot('job-details-error-1280');

    await load('/');
    await js("document.querySelector('.clear-history').click()");
    await wait("document.querySelector('dialog[open] .delete-count')?.textContent.includes('Will delete:')");
    const deletion = await js("document.querySelector('dialog[open]').textContent");
    assert.match(deletion, /Delete unfavorited creations\?/);
    assert.match(deletion, /from this device/);
    assert.match(deletion, /Favorites and all their versions/);
    assert.match(deletion, /associated job/);
    await shot('delete-unfavorited-1280');
    key('Escape');
    await wait("!document.querySelector('dialog[open]')");
    assert.equal(await js("window.__uiCalls.some(call=>call.url==='/api/deletion')"), false, 'reviewing and cancelling deletion does not delete');

    for (const [state, action, destination] of [
      ['disconnected', 'Connect service', '.service-picker'],
      ['missing', 'Finish setup', '.generation-choices'],
    ]) {
      window.setContentSize(420, 900);
      await load('/settings/welcome', state);
      for (const expected of ['.service-picker', '.generation-choices', '.wizard-summary']) {
        await js("document.querySelector('.wizard-footer .ui-button--primary').click()");
        await wait(`!!document.querySelector('.setup-wizard ${expected}')`);
      }
      assert.equal(await js("document.querySelector('.wizard-steps [aria-current=step]').textContent"), '4Review');
      await noOverflow('onboarding review ' + state);
      await shot('onboarding-review-' + state + '-420');
      await js("Array.from(document.querySelectorAll('.wizard-summary button')).find(button=>button.textContent.startsWith(" + JSON.stringify(action) + ")).click()");
      await wait(`!!document.querySelector('.setup-wizard ${destination}')`);
      assert.equal(await posts(), 0, 'review actions never generate');
      assert.equal(await js("window.__uiCalls.some(call=>call.url==='/api/pipelines/prepare')"), false, 'review actions never download');
    }
    await window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await load('/queue', 'busy');
    assert.ok(await js("parseFloat(getComputedStyle(document.querySelector('.job-status .spin')).animationDuration)<=0.00001"), 'reduced motion disables continuous progress animation');
    await noOverflow('reduced motion queue');
    await shot('queue-reduced-motion-420');
    window.webContents.debugger.detach();
    assert.deepEqual(errors, [], 'browser console errors');
    await fs.rm(path.join(screenshots, 'failure.png'), { force: true });
    console.log('Whole-app UX checks passed: 420/800/1280px, 200% zoom, visible navigation, explicit generation, recipe draft, keyboard, queue, deletion review, onboarding recovery and reduced motion. Synthetic data only.');
  } catch (error) {
    console.error(error);
    code = 1;
    if (window && !window.isDestroyed()) await fs.writeFile(path.join(screenshots, 'failure.png'), (await window.webContents.capturePage()).toPNG());
  } finally {
    clearTimeout(timeout);
    window?.destroy();
    await gallery?.close();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    app.exit(code);
  }
}
void smoke();
