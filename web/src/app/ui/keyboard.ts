// How much of the layout an on-screen keyboard covers, as `--keyboard` on the
// root, so the phone sheets (palette, New card) sit above it. iOS Safari puts
// the keyboard over the page and shrinks only the visual viewport; Android
// resizes the page instead (`interactive-widget` in the viewport tag), which
// leaves this at 0.
export function initKeyboardInset(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--keyboard', `${covered}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
