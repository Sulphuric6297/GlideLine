// Hand painted trees on the graphics chip (lib/brushCrown lists them): every brush stroke one small
// quad, a batch of them in two draws. The shader works each stroke out pixel by pixel from the
// same maths as the canvas painter: its squarish scalloped outline, its lighter edge toward the
// sun, the light across it, the bristles, the darker paint at its edge; its own random numbers from
// its seed, as the canvas painter's. The first draw marks where the crowns are solid; the second
// paints everything, the soft leaf shadows only there (as the canvas lays them only on paint
// already there), their softness worked out in the shader (no blur: iPhones have none on canvas).
// A big map is painted in tiles that fit the chip. Tested against the canvas painter: the same
// picture to within the browser's own variation.

/** The numbers each stroke (or crown base, or limb) carries: 6 groups of 4. */
export const OP = 24;
const MAX_TILE = 2048;

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 corner;
layout(location=1) in vec4 a0; layout(location=2) in vec4 a1; layout(location=3) in vec4 a2;
layout(location=4) in vec4 a3; layout(location=5) in vec4 a4; layout(location=6) in vec4 a5;
uniform vec2 uSize, uOff;
out vec2 px; flat out vec4 v0, v1, v2, v3, v4, v5;
void main() {
  float type = a1.y; vec2 c; float h;
  if (type > 2.5 && type < 3.5) { c = a4.xy; h = a4.z * 1.3 + 2.0; }
  else if (type > 3.5) { c = (a0.xy + a0.zw) * 0.5; h = length(a0.zw - a0.xy) * 0.5 + a1.x + 2.0; }
  else {
    // (a stroke: its quad along it, as long and wide as its scallops reach, its soft edge too; a
    // square round it would be mostly empty corners, each pixel worked out for nothing)
    vec2 u = vec2(cos(a0.z), sin(a0.z)), n = vec2(-u.y, u.x), pad = vec2(a3.w * 2.0 + 1.5);
    c = a0.xy + u * a0.w * 0.5;
    vec2 e = vec2(a0.w * 0.66, a1.x * 0.8) + pad;
    px = c + u * corner.x * e.x + n * corner.y * e.y;
    vec2 q0 = (px - uOff) / uSize * 2.0 - 1.0;
    gl_Position = vec4(q0.x, -q0.y, 0.0, 1.0);
    v0 = a0; v1 = a1; v2 = a2; v3 = a3; v4 = a4; v5 = a5;
    return;
  }
  px = c + corner * h;
  vec2 q = (px - uOff) / uSize * 2.0 - 1.0;
  gl_Position = vec4(q.x, -q.y, 0.0, 1.0);
  v0 = a0; v1 = a1; v2 = a2; v3 = a3; v4 = a4; v5 = a5;
}`;

const FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 px; flat in vec4 v0, v1, v2, v3, v4, v5;
uniform sampler2D uTexB, uMask;
uniform vec2 uSun, uMaskSize;
uniform vec3 uLight, uDark, uShadeRim;
uniform float uTex, uLift, uSink, uSc;
uniform int uPass;
out vec4 outc;
const float PI = 3.14159265;
// (the same numbers as the canvas painter's: lib/brushCrown, sh)
float sh(float seed, float k) {
  uint x = uint(seed) * 374761393u + uint(k) * 668265263u;
  x = (x ^ (x >> 13u)) * 1274126177u; x ^= x >> 16u;
  return float(x) / 4294967296.0;
}
// (a pine's leaflet, pine > 0.5: squarer, and wider toward its tip)
float shape(vec2 p, float len, float wid, float bumps, float seed, float pine) {
  float ph = sh(seed, 1.0) * 6.28, asymK = (sh(seed, 8.0) - 0.5) * 0.35;
  float L2 = len * 0.5, pe = pine > 0.5 ? 0.92 : 0.82, t = atan(p.y, p.x), X = 0.0, Y = 0.0, w = 0.0, b = 1.0;
  for (int it = 0; it < 4; it++) {
    float c = cos(t), s = sin(t);
    w = (wid * 0.5) * (pine > 0.5 ? 0.6 + 0.4 * c : 0.74 + 0.26 * c) * (1.0 + asymK * s);
    float warp = t + 0.35 * sin(t * 2.0 + ph) + 0.18 * sin(t * 5.0 + ph * 2.0);
    float u = (warp * bumps) / 6.2832 + ph, bi = floor(u), f = u - bi;
    float size = 0.72 + sh(seed, 100.0 + mod(bi, bumps)) * 0.7;
    b = 1.0 - uSc * size + uSc * size * 2.0 * pow(max(sin(f * PI), 0.0), 0.45);
    X = p.x / (L2 * b); Y = p.y / (w * b);
    t = atan(sign(Y) * pow(abs(Y), 1.0 / pe), sign(X) * pow(abs(X), 1.0 / pe));
  }
  float f = pow(pow(abs(X), 2.0 / pe) + pow(abs(Y), 2.0 / pe), pe * 0.5);
  float c = cos(t), s = sin(t);
  vec2 q = vec2(sign(c) * pow(abs(c), pe) * L2 * b, sign(s) * pow(abs(s), pe) * w * b);
  return (1.0 - f) * length(q);
}
float envAt(vec2 p) { vec2 d = p - v4.xy; float a = atan(d.y, d.x); return v4.z * (1.0 + v4.w * sin(a * 3.0 + v5.x) + v4.w * 0.6 * sin(a * 5.0 + v5.y)); }
vec3 overlay(vec3 b, vec3 s) { return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b)); }
void main() {
  float type = v1.y; vec3 col = v2.rgb / 255.0;
  // (the first draw: only the crowns' solid shade, as a mask of where the paint is)
  if (uPass == 0 && ((type > 0.5 && type < 2.5) || type > 3.5)) discard;
  if (type > 2.5 && type < 3.5) { float d = envAt(px) * 0.8 - length(px - v4.xy), cov = clamp(d + 0.5, 0.0, 1.0); outc = vec4(col * cov, cov); return; }
  if (type > 3.5) {
    vec2 a = v0.xy, pa = px - a, ba = v0.zw - a; float hh = clamp(dot(pa, ba) / max(1e-6, dot(ba, ba)), 0.0, 1.0);
    float cov = clamp(v1.x * 0.5 - length(pa - ba * hh) + 0.5, 0.0, 1.0) * v1.z; outc = vec4(col * cov, cov); return;
  }
  float ang = v0.z, len = v0.w, wid = v1.x, bumps = v1.w, seed = v3.z;
  vec2 u = vec2(cos(ang), sin(ang)), n = vec2(-u.y, u.x), c = v0.xy + u * len * 0.5, rel = px - c;
  float pine = v5.z;
  vec2 lp = vec2(dot(rel, u), dot(rel, n));
  float d = shape(lp, len, wid, bumps, seed, pine);
  if (type < 0.5) { float cov = clamp(d + 0.5, 0.0, 1.0) * v1.z; outc = vec4(col * cov, cov); return; }
  if (type > 1.5) {
    // a soft shadow: as soft as the canvas's blur, only on paint already there
    float bl = v3.w, cov = smoothstep(-2.0 * bl, 2.0 * bl, d) * v1.z;
    cov *= texture(uMask, gl_FragCoord.xy / uMaskSize).a;
    outc = vec4(col * cov, cov); return;
  }
  float cov = clamp(d + 0.5, 0.0, 1.0);
  vec3 o = col;
  // its edge toward the sun lighter: where the shape moved away from the sun doesn't cover
  if (v2.w > 0.0) {
    vec2 rT = rel + uSun * wid * 0.07;
    float dT = shape(vec2(dot(rT, u), dot(rT, n)), len, wid, bumps, seed, pine), band = max(0.6, wid * 0.08);
    float r = (1.0 - clamp(dT + 0.5, 0.0, 1.0)) * (1.0 - smoothstep(band - 0.5, band + 0.5, d));
    o = mix(o, mix(col, v3.x > 0.5 ? uShadeRim / 255.0 : uLight, v2.w), r);
  }
  // the light across it
  float R = max(len, wid), s = dot(rel, uSun) / (R * 0.6), gg = clamp(0.5 - s * 0.5, 0.0, 1.0);
  vec3 lightC = mix(col, uLight, uLift), darkC = mix(col, uDark, uSink);
  if (gg < 0.5) o = mix(o, mix(lightC, col, gg * 2.0), 1.0 - gg * 2.0); else o = mix(o, mix(col, darkC, gg * 2.0 - 1.0), gg * 2.0 - 1.0);
  // the bristles: about forty across, never finer than a pixel and a half; none on a stroke too small
  if (wid >= 5.0) {
    float pxs = max(1.5, wid / 40.0), fine = min(1.0, wid / 60.0), lum = dot(col, vec3(0.3, 0.59, 0.11));
    float a = uTex * min(1.0, max(v3.y, (lum - 0.2) * 2.2)) * (0.45 + 0.55 * fine);
    float rot = ang + PI * 0.5 + (sh(seed, 4.0) - 0.5) * 0.15;
    vec2 cr = vec2(cos(-rot), sin(-rot));
    vec2 q = vec2(rel.x * cr.x - rel.y * cr.y, rel.x * cr.y + rel.y * cr.x) / pxs + vec2(sh(seed, 6.0), sh(seed, 7.0)) * 256.0;
    o = mix(o, overlay(o, vec3(texture(uTexB, q / 256.0).r)), a);
  }
  // a pine leaflet's veins: a lighter one down its middle, fainter ones out to its lobes
  if (pine > 0.5) {
    vec3 vc = mix(col, uLight, v3.x > 0.5 ? 0.18 : 0.32);
    vec2 q = lp + vec2(len * 0.5, 0.0);
    float mw = max(0.6, wid * 0.05), md = length(q - vec2(clamp(q.x, 0.0, len * 0.82), 0.0));
    o = mix(o, vc, 0.75 * clamp(mw * 0.5 - md + 0.5, 0.0, 1.0));
    float sw = max(0.5, wid * 0.03);
    for (int k = 0; k < 6; k++) {
      float at = k < 2 ? 0.35 : k < 4 ? 0.55 : 0.72, side = (k - (k / 2) * 2) == 0 ? 1.0 : -1.0, l = wid * (0.32 + at * 0.2);
      vec2 a = vec2(len * at, 0.0), dir = vec2(0.7, side * 0.7) * l, pa = q - a;
      float hh = clamp(dot(pa, dir) / dot(dir, dir), 0.0, 1.0), sd = length(pa - dir * hh);
      o = mix(o, vc, 0.4 * clamp(sw * 0.5 - sd + 0.5, 0.0, 1.0));
    }
  }
  // the edge a shade darker, where the paint gathers
  float eb = max(0.5, wid * 0.04);
  o = mix(o, mix(col, uDark, 0.25), 0.22 * (1.0 - smoothstep(eb - 0.5, eb + 0.5, d)));
  outc = vec4(o * cov, cov);
}`;

type Gpu = {
  cv: HTMLCanvasElement; gl: WebGL2RenderingContext; pr: WebGLProgram; vao: WebGLVertexArrayObject; ib: WebGLBuffer;
  mask: WebGLTexture; fb: WebGLFramebuffer; tile: number; maskW: number; maskH: number; u: Record<string, WebGLUniformLocation | null>; texOk: boolean;
};
let gpu: Gpu | null | undefined;

/** The graphics chip's painter, made once; null where there's no WebGL2 (or it was lost), or no
 * real graphics chip: drawn in software (a computer with none, a test machine), the workers'
 * canvases are many times quicker. */
export const gpuPainter = (): Gpu | null => {
  if (gpu !== undefined) return gpu && !gpu.gl.isContextLost() ? gpu : (gpu = null);
  try {
    if (typeof document === "undefined") return (gpu = null);
    const cv = document.createElement("canvas");
    const gl = cv.getContext("webgl2", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, alpha: true, failIfMajorPerformanceCaveat: true });
    if (!gl) return (gpu = null);
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader"); return s; };
    const pr = gl.createProgram()!;
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) ?? "link");
    gl.useProgram(pr);
    const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
    const qb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    for (let k = 0; k < 6; k++) { gl.enableVertexAttribArray(k + 1); gl.vertexAttribPointer(k + 1, 4, gl.FLOAT, false, OP * 4, k * 16); gl.vertexAttribDivisor(k + 1, 1); }
    const mask = gl.createTexture()!, fb = gl.createFramebuffer()!;
    const tile = Math.min(MAX_TILE, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, ...(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array));
    const names = ["uSize", "uOff", "uTexB", "uMask", "uSun", "uMaskSize", "uLight", "uDark", "uShadeRim", "uTex", "uLift", "uSink", "uSc", "uPass"];
    const u: Gpu["u"] = {}; for (const nm of names) u[nm] = gl.getUniformLocation(pr, nm);
    gl.uniform1i(u.uTexB, 0); gl.uniform1i(u.uMask, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    cv.addEventListener("webglcontextlost", e => { e.preventDefault(); gpu = null; });
    return (gpu = { cv, gl, pr, vao, ib, mask, fb, tile, maskW: 0, maskH: 0, u, texOk: false });
  } catch (err) {
    console.warn("Hand painted: no graphics chip painter", err);
    return (gpu = null);
  }
};

export type GpuLook = { sun: number[]; light: number[]; dark: number[]; shadeRim: number[]; tex: number; lift: number; sink: number; scallop: number };

/** A map's painting on the chip: one texture a tile, kept until every batch is painted on it. */
export type GpuMap = { W: number; H: number; tw: number; th: number; tiles: { x: number; y: number; tex: WebGLTexture; fb: WebGLFramebuffer }[] };

/** Starts a map's painting (W x H), its tiles cleared; null when the chip can't. */
export const beginMap = (p: Gpu, W: number, H: number, look: GpuLook, bristles: TexImageSource): GpuMap | null => {
  const { gl, u } = p;
  if (gl.isContextLost()) return null;
  gl.useProgram(p.pr); gl.bindVertexArray(p.vao);
  if (!p.texOk) {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bristles);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    p.texOk = true;
  }
  gl.uniform2f(u.uSun, look.sun[0], look.sun[1]);
  gl.uniform3f(u.uLight, look.light[0] / 255, look.light[1] / 255, look.light[2] / 255);
  gl.uniform3f(u.uDark, look.dark[0] / 255, look.dark[1] / 255, look.dark[2] / 255);
  gl.uniform3f(u.uShadeRim, look.shadeRim[0], look.shadeRim[1], look.shadeRim[2]);
  gl.uniform1f(u.uTex, look.tex); gl.uniform1f(u.uLift, look.lift); gl.uniform1f(u.uSink, look.sink); gl.uniform1f(u.uSc, look.scallop);
  const tw = Math.min(p.tile, W), th = Math.min(p.tile, H);
  if (p.cv.width !== tw || p.cv.height !== th) { p.cv.width = tw; p.cv.height = th; }
  const target = (w: number, h: number) => {
    const tex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb };
  };
  gl.activeTexture(gl.TEXTURE1);
  if (p.maskW !== tw || p.maskH !== th) {
    gl.deleteTexture(p.mask); gl.deleteFramebuffer(p.fb);
    const m = target(tw, th); p.mask = m.tex; p.fb = m.fb; p.maskW = tw; p.maskH = th;
  }
  const tiles: GpuMap["tiles"] = [];
  for (let y = 0; y < H; y += th) for (let x = 0; x < W; x += tw) tiles.push({ x, y, ...target(tw, th) });
  gl.bindTexture(gl.TEXTURE_2D, null); gl.activeTexture(gl.TEXTURE0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.uniform2f(u.uSize, tw, th); gl.uniform2f(u.uMaskSize, tw, th);
  gl.viewport(0, 0, tw, th);
  return { W, H, tw, th, tiles };
};

/** A batch of listed ops (`data`, `count` of them) painted onto every tile: the mask first, then
 * everything. False when the chip failed. */
export const paintBatch = (p: Gpu, m: GpuMap, data: Float32Array, count: number) => {
  const { gl, u } = p;
  if (gl.isContextLost()) return false;
  gl.useProgram(p.pr); gl.bindVertexArray(p.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, p.ib); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * OP), gl.STREAM_DRAW);
  gl.clearColor(0, 0, 0, 0);
  for (const t of m.tiles) {
    gl.uniform2f(u.uOff, t.x, t.y);
    // (the mask: not read while it's drawn into)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, p.fb); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1i(u.uPass, 0); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindTexture(gl.TEXTURE_2D, p.mask); gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.uniform1i(u.uPass, 1); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return !gl.isContextLost();
};

/** A painting stopped part way: its tiles let go, nothing laid on the map. */
export const dropMap = (p: Gpu, m: GpuMap) => {
  for (const t of m.tiles) { p.gl.deleteTexture(t.tex); p.gl.deleteFramebuffer(t.fb); }
  m.tiles = [];
};

/** The painting laid on the map (`g`), tile by tile, once; its tiles let go. */
export const endMap = (p: Gpu, m: GpuMap, g: CanvasRenderingContext2D) => {
  const { gl } = p;
  let ok = !gl.isContextLost();
  for (const t of m.tiles) {
    if (ok) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, m.tw, m.th, 0, 0, m.tw, m.th, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      ok = !gl.isContextLost();
      const w = Math.min(m.tw, m.W - t.x), h = Math.min(m.th, m.H - t.y);
      if (ok) g.drawImage(p.cv, 0, 0, w, h, t.x, t.y, w, h);
    }
    gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb);
  }
  return ok;
};
