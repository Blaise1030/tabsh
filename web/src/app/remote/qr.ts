// The pairing QR code as SVG elements, one <rect> per dark module. The
// encoder is reached only through import(): it loads when the dialog first
// needs a code, never with the page.
const NS = 'http://www.w3.org/2000/svg';
// A QR code needs this many light modules around it to scan.
const QUIET = 4;

export async function qrSvg(text: string): Promise<SVGSVGElement> {
  const { encode } = await import('uqr');
  const { size, data } = encode(text, { border: 0 });
  const full = size + QUIET * 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${full} ${full}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code for the device link');
  // A white ground, so the code scans in dark themes too.
  const ground = document.createElementNS(NS, 'rect');
  ground.setAttribute('width', String(full));
  ground.setAttribute('height', String(full));
  ground.setAttribute('fill', '#fff');
  svg.append(ground);
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (!dark) return;
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', String(x + QUIET));
      rect.setAttribute('y', String(y + QUIET));
      rect.setAttribute('width', '1');
      rect.setAttribute('height', '1');
      rect.setAttribute('fill', '#000');
      svg.append(rect);
    });
  });
  return svg;
}
