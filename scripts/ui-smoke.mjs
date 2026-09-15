import { app, BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startUIGallery } from './ui-gallery.mjs';

const profile = mkdtempSync(path.join(os.tmpdir(), 'frok-ui-smoke-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
async function smoke() {
  const timeout = setTimeout(() => {
    console.error('UI checks timed out.');
    app.exit(1);
  }, 90000);
  let gallery,
    window,
    code = 0;
  const screenshots = path.resolve('.data/ui-checks');
  try {
    await app.whenReady();
    gallery = await startUIGallery({ port: 0, watch: false });
    await fs.mkdir(screenshots, { recursive: true });
    window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      useContentSize: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const errors = [];
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(event.message);
    });
    const js = async (expression) => {
      try { return await window.webContents.executeJavaScript(expression); }
      catch (error) { throw Error(`UI expression failed: ${expression}\n${errors.join('\n')}\n${error.message}`); }
    };
    async function wait(expression) {
      for (let i = 0; i < 100; i++) {
        if (await js(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw Error('Timed out: ' + expression + '\n' + errors.join('\n'));
    }
    async function load(view, state = 'connected') {
      await window.loadURL(`${gallery.url}/?view=${view}&state=${state}`);
      await wait("!!document.querySelector('.ui-gallery')");
      if (['services', 'generation', 'recipes', 'advanced'].includes(view))
        await wait("!!document.querySelector('.settings-page')");
      if (view === 'onboarding') await wait("!!document.querySelector('dialog[open]')");
      if (view === 'advanced') await wait("!!document.querySelector('#api-tokens input')");
      if (view === 'recipes') await wait("document.querySelector('.preset-list') !== null");
      await js('document.fonts.ready');
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    async function noOverflow(label) {
      assert.equal(
        await js('document.documentElement.scrollWidth <= innerWidth + 1'),
        true,
        label + ' page overflow',
      );
      const overflow = await js(
        "Array.from(document.querySelectorAll('.ui-card,.ui-field,.ui-form-actions,.setup-wizard')).filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>el.className)",
      );
      assert.deepEqual(overflow, [], label + ' component overflow');
    }
    for (const width of [420, 800, 1280]) {
      window.setContentSize(width, 900);
      for (const view of [
        'primitives',
        'services',
        'generation',
        'recipes',
        'advanced',
        'onboarding',
      ]) {
        await load(view);
        await noOverflow(`${view} ${width}`);
        if (view === 'primitives' || view === 'generation') {
          const selects = await js(`Array.from(document.querySelectorAll('.ui-select')).map(el => {
            const style = getComputedStyle(el);
            return { appearance: style.appearance, arrow: style.backgroundImage !== 'none',
              inset: style.backgroundPositionX, padding: parseFloat(style.paddingRight) };
          })`);
          assert.ok(selects.length > 0, `${view} renders shared dropdowns`);
          for (const select of selects) {
            assert.equal(select.appearance, 'none', `${view} uses an inset dropdown arrow`);
            assert.equal(select.arrow, true, `${view} dropdown arrow is visible`);
            assert.equal(select.inset, 'calc(100% - 12px)', `${view} dropdown arrow has edge spacing`);
            assert.ok(select.padding >= 40, `${view} dropdown text leaves room for its arrow`);
          }
        }
        await fs.writeFile(
          path.join(screenshots, `${view}-${width}.png`),
          (await window.webContents.capturePage()).toPNG(),
        );
        if (view === 'generation') {
          await load(view, 'missing');
          await noOverflow(`missing models ${width}`);
          assert.equal(await js("document.querySelector('.generation-choices').textContent.includes('Setup instructions')"), true);
          assert.equal(await js("Array.from(document.querySelectorAll('button')).filter(button => button.textContent.includes('Prepare models')).length"), 1);
          await fs.writeFile(
            path.join(screenshots, `generation-missing-${width}.png`),
            (await window.webContents.capturePage()).toPNG(),
          );
          await js("Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Prepare models')).click()");
          await wait("document.querySelector('.workflow-preparation')?.textContent.includes('Preparation queued')");
          assert.equal(await js("window.__uiCalls.filter(call=>call.url==='/api/pipelines/prepare').length"), 1);
        }
      }
    }
    window.webContents.setZoomFactor(2);
    for (const view of [
      'primitives',
      'services',
      'generation',
      'recipes',
      'advanced',
      'onboarding',
    ]) {
      await load(view);
      await noOverflow(`${view} 200% zoom`);
    }
    await fs.writeFile(
      path.join(screenshots, 'onboarding-zoom.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    window.webContents.setZoomFactor(1);
    for (const state of ['disconnected', 'offline', 'busy', 'error']) {
      await load('services', state);
      await noOverflow(state);
      await js(
        "Array.from(document.querySelectorAll('button')).find(el=>el.textContent.includes('Vpipe')).click()",
      );
      await wait("!!document.querySelector('.settings-service-panel')");
      if (state === 'busy')
        assert.equal(
          await js(
            "document.querySelector('.settings-service-panel button[type=submit]').disabled",
          ),
          true,
        );
      await fs.writeFile(
        path.join(screenshots, `services-${state}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
    }
    for (const state of ['disconnected', 'offline', 'busy', 'missing']) {
      await load('onboarding', state);
      await noOverflow('onboarding ' + state);
      assert.equal(await js("document.querySelector('.wizard-intro h2').textContent"), 'Welcome to Frok');
      await wait("!!document.querySelector('.welcome-demo')?.contentDocument?.querySelector('.workflow-demo')");
      await js("document.querySelector('.wizard-footer .ui-button--primary').click()");
      await wait("!!document.querySelector('.service-picker')");
      if (state === 'busy')
        assert.equal(
          await js("document.querySelector('.wizard-footer .ui-button--primary').disabled"),
          true,
        );
      else {
        await js("document.querySelector('.wizard-footer .ui-button--primary').click()");
        await wait("!!document.querySelector('.generation-choices')");
        await noOverflow('onboarding workflows ' + state);
        if (state === 'missing') {
          assert.equal(
            await js(
              "document.querySelector('.generation-choices').textContent.includes('Setup instructions')",
            ),
            true,
          );
          await js("document.querySelector('.wizard-footer .ui-button--primary').click()");
          await wait("!!document.querySelector('.wizard-summary')");
          assert.equal(
            await js("window.__uiCalls.filter(call=>call.url==='/api/setup').length"),
            0,
            'wizard navigation never submits installation jobs',
          );
          assert.equal(await js("window.__uiCalls.filter(call=>call.url==='/api/pipelines/prepare').length"), 0);
          await js("Array.from(document.querySelectorAll('.wizard-footer button')).find(button=>button.textContent.includes('Back')).click()");
          await wait("!!document.querySelector('.generation-choices')");
          await js("Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Prepare models')).click()");
          await wait("document.querySelector('.workflow-preparation')?.textContent.includes('Preparation queued')");
          await js("document.querySelector('.workflow-preparation a').click()");
          await wait("!document.querySelector('dialog[open]')");
        }
      }
    }
    for (const width of [420, 1280]) {
      window.setContentSize(width, 900);
      await load('recipes');
      await js("(()=>{const edit=document.querySelector('.preset-actions button[aria-label^=Edit]');edit.focus();edit.click();})()");
      await wait("!!document.querySelector('.preset-editor-dialog[open]')");
      assert.equal(await js("document.activeElement === document.querySelector('.preset-editor-dialog input')"), true, 'recipe name receives focus');
      assert.equal(await js("(()=>{const r=document.querySelector('.preset-editor-dialog').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth;})()"), true, 'recipe editor stays within viewport');
      await noOverflow(`recipe editor ${width}`);
      await fs.writeFile(path.join(screenshots, `recipe-editor-${width}.png`), (await window.webContents.capturePage()).toPNG());
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await wait("!document.querySelector('.preset-editor-dialog')");
      assert.equal(await js("document.activeElement === document.querySelector('.preset-actions button[aria-label^=Edit]')"), true, 'focus returns to recipe Edit button');
    }
    await load('services');
    await js(
      "Array.from(document.querySelectorAll('button')).find(el=>el.textContent.includes('Vpipe')).click()",
    );
    await wait("!!document.querySelector('.settings-service-panel')");
    await js("document.querySelector('.settings-service-panel .ui-field-label').click()");
    assert.equal(
      await js(
        "document.activeElement === document.querySelector('.settings-service-panel input')",
      ),
      true,
      'clicking label focuses input',
    );
    await js("document.querySelector('.settings-service-panel button[type=submit]').click()");
    await wait("window.__uiCalls.some(call=>call.url==='/api/settings' && call.method==='PATCH')");
    assert.equal(
      await js(
        "window.__uiCalls.filter(call=>call.url==='/api/settings' && call.method==='PATCH').length",
      ),
      1,
      'submit called once',
    );
    await load('primitives');
    const click = (text) =>
      js(
        `(()=>{const button=Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(text)});button.focus();button.click();})()`,
      );
    await click('Clear');
    assert.equal(
      await js('document.activeElement.name'),
      'example',
      'native ref forwards to input',
    );
    await click('Open confirmation');
    await wait("!!document.querySelector('dialog[open]')");
    assert.equal(
      await js("document.activeElement.closest('dialog[open]') !== null"),
      true,
      'initial focus is inside dialog',
    );
    await js("Array.from(document.querySelectorAll('dialog button')).at(-1).focus()");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await wait("document.activeElement.type==='checkbox'");
    await js("document.querySelector('dialog input').click()");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    assert.equal(
      await js("!!document.querySelector('dialog[open]')"),
      true,
      'busy dialog stays open',
    );
    await js("document.querySelector('dialog input').click()");
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait("!document.querySelector('dialog[open]')");
    assert.equal(
      await js('document.activeElement.textContent.trim()'),
      'Open confirmation',
      'focus returns to opener',
    );
    await load('primitives');
    // Chromium emulation covers the CSS preference independently of the host setting.
    await window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    assert.equal(
      await js("getComputedStyle(document.querySelector('.ui-spinner')).animationName"),
      'none',
    );
    window.webContents.debugger.detach();
    assert.deepEqual(errors, [], 'browser errors');
    console.log(
      'UI checks passed: six views at 420/800/1280px, 200% zoom, service states, submission, field focus, dialog Tab/Escape/focus restoration, and reduced motion. Synthetic data only.',
    );
  } catch (error) {
    console.error(error);
    code = 1;
    if (window && !window.isDestroyed())
      await fs.writeFile(
        path.join(screenshots, 'failure.png'),
        (await window.webContents.capturePage()).toPNG(),
      );
  } finally {
    clearTimeout(timeout);
    window?.destroy();
    await gallery?.close();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    app.exit(code);
  }
}
void smoke();
