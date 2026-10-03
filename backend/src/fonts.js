// Poppins (geometric sans-serif, SIL OFL) is bundled in assets/fonts so the
// bot never depends on an external font host. Shared by every canvas-drawn
// image (banners, charts). Bold is used for headings/prices, Regular for
// smaller labels and the watermark.
import { GlobalFonts } from '@napi-rs/canvas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

export const FONT_BOLD = '"Banner Bold", "Helvetica Neue", Arial, sans-serif';
export const FONT_REGULAR = '"Banner Regular", "Helvetica Neue", Arial, sans-serif';

let fontsRegistered = false;
export function ensureFontsRegistered() {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(path.join(ASSETS_DIR, 'fonts', 'Poppins-Bold.ttf'), 'Banner Bold');
  GlobalFonts.registerFromPath(path.join(ASSETS_DIR, 'fonts', 'Poppins-Regular.ttf'), 'Banner Regular');
  fontsRegistered = true;
}
