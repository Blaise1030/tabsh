// Bells are found in the raw bytes as they arrive rather than via xterm's
// onBell: xterm parses on a timer, which a hidden tab throttles (Chrome
// eventually to once a minute), so onBell fires late exactly when you're
// elsewhere. BEL also terminates OSC strings (shells set the title on every
// prompt), so track just enough escape state to skip those. The state
// carries across chunks; 8-bit C1 controls are ignored since the stream is UTF-8.
export const TEXT = 0;
const ESC = 1;
const STR = 2;
const STR_ESC = 3;

export function scanBell(esc: number, bytes: Uint8Array): { esc: number; bell: boolean } {
  let st = esc;
  let bell = false;
  for (const b of bytes) {
    if (st === STR_ESC) st = b === 0x5c ? TEXT : ESC; // ESC \ ends the string; any other ESC aborts it
    if (st === STR) {
      if (b === 0x07 || b === 0x18 || b === 0x1a)
        st = TEXT; // BEL terminates; CAN/SUB abort
      else if (b === 0x1b) st = STR_ESC;
    } else if (st === ESC) {
      // OSC, DCS, APC, PM and SOS take a string argument.
      st = b === 0x5d || b === 0x50 || b === 0x5f || b === 0x5e || b === 0x58 ? STR : b === 0x1b ? ESC : TEXT;
    } else if (st === TEXT) {
      if (b === 0x07) bell = true;
      else if (b === 0x1b) st = ESC;
    }
  }
  return { esc: st, bell };
}
