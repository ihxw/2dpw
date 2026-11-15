import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[n] = c >>> 0;
  }
  return tbl;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([lenBuf, body, crcBuf]);
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Deterministic 0..1 pixel hash for stone, grass, water, bark, and blossom noise. */
export function hash2d(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export type RgbaTuple = [number, number, number, number];

/** Lightweight 32-bit RGBA canvas for procedural PWI 1.3.6 art synthesis. */
export class RgbaCanvas {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    initialData?: Uint8Array,
  ) {
    this.data = initialData ?? new Uint8Array(width * height * 4);
  }

  clone(): RgbaCanvas {
    return new RgbaCanvas(this.width, this.height, new Uint8Array(this.data));
  }

  getPixel(x: number, y: number): RgbaTuple {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return [0, 0, 0, 0];
    const idx = (iy * this.width + ix) * 4;
    return [this.data[idx]!, this.data[idx + 1]!, this.data[idx + 2]!, this.data[idx + 3]!];
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a = 255): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return;
    const idx = (iy * this.width + ix) * 4;
    this.data[idx] = clampByte(r);
    this.data[idx + 1] = clampByte(g);
    this.data[idx + 2] = clampByte(b);
    this.data[idx + 3] = clampByte(a);
  }

  blendPixel(x: number, y: number, r: number, g: number, b: number, a = 255): void {
    if (a <= 0) return;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return;
    const idx = (iy * this.width + ix) * 4;
    const sa = Math.min(255, Math.max(0, a)) / 255;
    if (sa >= 0.999) {
      this.data[idx] = clampByte(r);
      this.data[idx + 1] = clampByte(g);
      this.data[idx + 2] = clampByte(b);
      this.data[idx + 3] = 255;
      return;
    }
    const da = this.data[idx + 3]! / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) return;
    const dr = this.data[idx]!;
    const dg = this.data[idx + 1]!;
    const db = this.data[idx + 2]!;
    this.data[idx] = clampByte((r * sa + dr * da * (1 - sa)) / outA);
    this.data[idx + 1] = clampByte((g * sa + dg * da * (1 - sa)) / outA);
    this.data[idx + 2] = clampByte((b * sa + db * da * (1 - sa)) / outA);
    this.data[idx + 3] = clampByte(outA * 255);
  }

  fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
    a = 255,
  ): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        this.blendPixel(px, py, r, g, b, a);
      }
    }
  }

  fillCircle(
    cx: number,
    cy: number,
    radius: number,
    r: number,
    g: number,
    b: number,
    a = 255,
  ): void {
    this.fillEllipse(cx, cy, radius, radius, r, g, b, a);
  }

  fillEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    r: number,
    g: number,
    b: number,
    a = 255,
  ): void {
    if (rx <= 0 || ry <= 0) return;
    const x0 = Math.max(0, Math.floor(cx - rx - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + ry + 1));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = (px - cx) / rx;
        const dy = (py - cy) / ry;
        const dist = dx * dx + dy * dy;
        if (dist <= 1) {
          const edge = Math.min(1, Math.max(0, (1 - Math.sqrt(dist)) * Math.min(rx, ry) * 1.4));
          this.blendPixel(px, py, r, g, b, a * edge);
        }
      }
    }
  }

  drawLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    thickness: number,
    r: number,
    g: number,
    b: number,
    a = 255,
  ): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    const radius = Math.max(0.6, thickness * 0.5);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (radius <= 0.8) {
        this.blendPixel(x, y, r, g, b, a);
      } else {
        this.fillCircle(x, y, radius, r, g, b, a);
      }
    }
  }

  /**
   * Fill a 2:1 isometric diamond centered at `(cx, cy)` with pixel-level shading.
   * `(u, v)` are isometric UV coordinates in `[-1, 1]` along the two tile axes.
   */
  fillIsoDiamond(
    cx: number,
    cy: number,
    halfW: number,
    halfH: number,
    colorFn: (dx: number, dy: number, u: number, v: number, edgeDist: number) => RgbaTuple,
  ): void {
    const x0 = Math.max(0, Math.floor(cx - halfW));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + halfW));
    const y0 = Math.max(0, Math.floor(cy - halfH));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + halfH));
    for (let py = y0; py <= y1; py++) {
      const dy = py - cy;
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx;
        const norm = Math.abs(dx) / halfW + Math.abs(dy) / halfH;
        if (norm <= 1.005) {
          const u = dx / halfW + dy / halfH;
          const v = dy / halfH - dx / halfW;
          const [r, g, b, a] = colorFn(dx, dy, u, v, 1 - norm);
          const aa = norm > 0.985 ? Math.max(0, (1.005 - norm) / 0.02) : 1;
          this.blendPixel(px, py, r, g, b, a * aa);
        }
      }
    }
  }

  blit(
    src: RgbaCanvas,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
  ): void {
    const iw = Math.floor(sw);
    const ih = Math.floor(sh);
    for (let py = 0; py < ih; py++) {
      for (let px = 0; px < iw; px++) {
        const [r, g, b, a] = src.getPixel(sx + px, sy + py);
        if (a > 0) this.blendPixel(dx + px, dy + py, r, g, b, a);
      }
    }
  }
}

export function encodePng(canvas: RgbaCanvas): Buffer {
  const { width, height, data } = canvas;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colorType 6 = RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowOff = y * (stride + 1);
    raw[rowOff] = 0; // filter 0 = None
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, rowOff + 1);
  }
  const compressed = deflateSync(raw, { level: 6 });

  return Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function decodePng(buf: Buffer): RgbaCanvas {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('Invalid PNG signature');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts: Buffer[] = [];
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;

  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkData = buf.subarray(dataStart, dataEnd);
    offset = dataEnd + 4; // skip CRC

    if (type === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8]!;
      colorType = chunkData[9]!;
      interlace = chunkData[12]!;
    } else if (type === 'PLTE') {
      palette = new Uint8Array(chunkData);
    } else if (type === 'tRNS') {
      trns = new Uint8Array(chunkData);
    } else if (type === 'IDAT') {
      idatParts.push(chunkData);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error(
      `Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}`,
    );
  }

  const bpp =
    colorType === 6
      ? 4
      : colorType === 2
        ? 3
        : colorType === 4
          ? 2
          : colorType === 0 || colorType === 3
            ? 1
            : 0;
  if (bpp === 0) {
    throw new Error(`Unsupported PNG colorType=${colorType}`);
  }

  const raw = inflateSync(Buffer.concat(idatParts));
  const scanlineBytes = width * bpp;
  const unfilt = new Uint8Array(height * scanlineBytes);

  for (let y = 0; y < height; y++) {
    const srcOff = y * (scanlineBytes + 1);
    const filter = raw[srcOff]!;
    const dstOff = y * scanlineBytes;
    const prevOff = (y - 1) * scanlineBytes;

    for (let x = 0; x < scanlineBytes; x++) {
      const val = raw[srcOff + 1 + x]!;
      const a = x >= bpp ? unfilt[dstOff + x - bpp]! : 0;
      const b = y > 0 ? unfilt[prevOff + x]! : 0;
      const c = y > 0 && x >= bpp ? unfilt[prevOff + x - bpp]! : 0;

      let recon = val;
      if (filter === 1) recon = (val + a) & 0xff;
      else if (filter === 2) recon = (val + b) & 0xff;
      else if (filter === 3) recon = (val + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) recon = (val + paethPredictor(a, b, c)) & 0xff;
      unfilt[dstOff + x] = recon;
    }
  }

  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (colorType === 6) {
      out[o] = unfilt[o]!;
      out[o + 1] = unfilt[o + 1]!;
      out[o + 2] = unfilt[o + 2]!;
      out[o + 3] = unfilt[o + 3]!;
    } else if (colorType === 2) {
      const s = i * 3;
      out[o] = unfilt[s]!;
      out[o + 1] = unfilt[s + 1]!;
      out[o + 2] = unfilt[s + 2]!;
      out[o + 3] = 255;
    } else if (colorType === 3) {
      const idx = unfilt[i]!;
      if (palette && idx * 3 + 2 < palette.length) {
        out[o] = palette[idx * 3]!;
        out[o + 1] = palette[idx * 3 + 1]!;
        out[o + 2] = palette[idx * 3 + 2]!;
        out[o + 3] = trns && idx < trns.length ? trns[idx]! : 255;
      }
    } else if (colorType === 4) {
      const s = i * 2;
      const v = unfilt[s]!;
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = unfilt[s + 1]!;
    } else {
      const v = unfilt[i]!;
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    }
  }

  return new RgbaCanvas(width, height, out);
}
