export const trayFrameCount = 8;
export const trayVariants = ['idle', 'update', ...Array.from({ length: trayFrameCount }, (_, i) => [`busy-${i}`, `busy-update-${i}`]).flat()];

export function traySvg(mark, variant) {
  const busy = variant.startsWith('busy'), update = variant.includes('update');
  const frame = busy ? Number(variant.split('-').at(-1)) : 0;
  const symbol = mark.replace('<svg ', '<svg x="0" y="0" width="16" height="16" ');
  // Clear a small corner of the mark for the badge. Transparency keeps macOS
  // template tinting intact; every state retains the same 16-point footprint.
  const mask = '<defs><mask id="badge-space"><rect width="16" height="16" fill="white"/><circle cx="12.5" cy="12.5" r="3.7" fill="black"/></mask></defs>';
  const spinner = busy ? `<g transform="rotate(${frame * 360 / trayFrameCount} 12.5 12.5)"><circle cx="12.5" cy="12.5" r="2.75" fill="none" stroke="black" stroke-width=".9" stroke-dasharray="12 6" stroke-linecap="round"/></g>` : '';
  const arrow = update ? `<path d="${busy ? 'M12.5 14v-3m-1.1 1.1 1.1-1.1 1.1 1.1' : 'M12.5 14.5v-4m-1.7 1.7 1.7-1.7 1.7 1.7'}" fill="none" stroke="black" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${busy || update ? `${mask}<g mask="url(#badge-space)">${symbol}</g>` : symbol}${spinner}${arrow}</svg>`;
}

export function createTrayAnimator({ tray, images, every = setInterval, cancel = clearInterval }) {
  let timer, current = '', frame = 0;
  const stop = () => { if (timer !== undefined) cancel(timer); timer = undefined; };
  return {
    set({ running, updateAvailable, reducedMotion = false }) {
      const kind = running ? `busy${updateAvailable ? '-update' : ''}` : updateAvailable ? 'update' : 'idle';
      const key = `${kind}:${reducedMotion}`;
      if (current === key) return;
      current = key; stop(); frame = 0;
      const draw = () => tray.setImage(images[running ? `${kind}-${frame}` : kind]);
      draw();
      if (running && !reducedMotion) { timer = every(() => { frame = (frame + 1) % trayFrameCount; draw(); }, 150); timer.unref?.(); }
    },
    dispose: stop,
  };
}
