// A software-rasterized WebGL context (SwiftShader, llvmpipe, ...) works, but
// paints a busy terminal far slower than xterm's DOM renderer: each frame
// blocks the page for hundreds of milliseconds. Treat it as no WebGL, so the
// terminal stays on the DOM renderer there; real GPUs keep WebGL.
const software = /swiftshader|software|llvmpipe|basic render/i;

export function softwareRenderer(renderer: string | null): boolean {
  return renderer === null || software.test(renderer);
}
