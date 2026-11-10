// The site's ground: terrain, the aerial photo draped on it, grid, contours, elevation shading and
// the cut-away sides that make a sloped site read as a block of land.
import * as THREE from "three";
import { MAP_OVERLAY_OFFSET } from "../constants";
import { heightAt } from "../lib/terrainGrid";
import { elevationColor } from "../lib/terrain";
import { disposeObjectDeep } from "../three/dispose";
import { GROUND_MATERIALS, PAINT_CELL_FT } from "../lib/groundPaint";
import { addGroundDetail, coverTexture, groundDetailUniforms, groundScans } from "../three/groundDetail";
import type { GroundDoc as ViewDoc } from "./types";

const noRaycast = (o: THREE.Object3D) => { o.raycast = () => {}; return o; };

export class Ground {
  readonly group = new THREE.Group();
  terrain: THREE.Mesh | null = null;
  photo: THREE.Texture | null = null;
  private photoUrl: string | null = null;
  /** The painted map draped in place of the photo (flyovers, the tee view, videos), once loaded. */
  private painted: THREE.Texture | null = null;
  private paintedUrl: string | null = null;
  private paintedReady: Promise<void> = Promise.resolve();
  private bgOpacity = 1;
  private mapPlane: THREE.Mesh | null = null;
  /** The sharper painting round one hole, over the painted map (see setPaintedDetail). */
  private detailPlane: THREE.Mesh | null = null;
  private detailPainting: { canvas: HTMLCanvasElement; rect: { x: number; y: number; width: number; height: number } } | null = null;
  private lastDoc: ViewDoc | null = null;
  private shade: THREE.Mesh | null = null;
  /** Map-only drawings on the ground (grid, site edge, contours, cut-away sides): hidden in camera views. */
  extras = new THREE.Group();
  /** The cut-away sides of a sloped site (part of `extras`). */
  sides: THREE.Object3D | null = null;
  /** Land around the site out to the horizon, for the tilted and tee views (see `landscape`). */
  skirt: THREE.Mesh | null = null;
  private key = "";
  private heightsRef: Record<string, number> | null = null;
  private overlayKey = "";
  /** Real-scale ground from scans (grass, paving, dirt, the woods' floor) over the photo or the painted map, and painted ground (see three/groundDetail). */
  readonly detail = groundDetailUniforms();
  private photoFt = 0;
  private wantDetail = true;
  private close = true;
  // (not until the view says so: the scans are a few megabytes to load and unpack, seconds of a
  // processor's time where there is no graphics card to use them)
  private card = false;
  /** Painted ground as drawn so far, and the textures it is drawn into (one texel per painted square). */
  private paint: Record<string, number> = {};
  private paintGrid: { cols: number; rows: number; per: number; cell: number; color: Uint8Array; cover: Uint8Array } | null = null;

  constructor(private renderer: THREE.WebGLRenderer, private onChanged: () => void) {
    this.group.name = "ground";
    this.group.add(this.extras);
  }

  private h(doc: ViewDoc, x: number, y: number) {
    return heightAt(doc.heights, doc.gridSize, x, y);
  }

  /** Rebuilds what changed. Returns true when anything did. */
  update(doc: ViewDoc) {
    this.lastDoc = doc;
    const bg = doc.background;
    let changed = false;
    const key = JSON.stringify([doc.canvas, doc.gridSize, bg.rect, !!bg.url, doc.showGrid]);
    if (this.bgOpacity !== bg.opacity) {
      this.bgOpacity = bg.opacity;
      this.applyMap();
      changed = true;
    }
    this.photoFt = bg.rect.width / (doc.unitsPerFoot || 1);
    this.detail.coverRect.value.set(bg.rect.x, bg.rect.y, bg.rect.width, bg.rect.height);
    this.detail.groundFeet.value = 1 / (doc.unitsPerFoot || 1);
    if (this.wantDetail !== doc.groundDetail) {
      this.wantDetail = doc.groundDetail;
      this.detailActive(this.close);
      changed = true;
    }
    if (this.updatePaint(doc)) changed = true;
    if (key !== this.key || !this.terrain) {
      this.key = key;
      this.rebuild(doc);
      this.heightsRef = doc.heights;
      changed = true;
    } else if (this.heightsRef !== doc.heights) {
      this.heightsRef = doc.heights;
      this.reshape(doc);
      changed = true;
    }
    if (bg.url !== this.photoUrl) {
      this.photoUrl = bg.url;
      this.loadPhoto(bg.url);
      changed = true;
    }
    const overlayKey = JSON.stringify([doc.overlay, doc.contours.interval, doc.contours.segments.length, doc.terrain, doc.shadeUrl?.length ?? 0, !!bg.url, doc.groundColor]);
    if (changed || overlayKey !== this.overlayKey) {
      this.overlayKey = overlayKey;
      this.updateOverlays(doc);
      changed = true;
    }
    return changed;
  }

  /** The painted map on the ground now (loaded), or null. */
  get paintedTexture() {
    return this.painted;
  }

  /** What the map plane shows: the painted map when there is one, else the photo (as visible as asked). */
  private applyMap() {
    const mat = this.mapPlane?.material as THREE.MeshLambertMaterial | undefined;
    const map = this.painted ?? this.photo;
    if (mat) {
      if (mat.map !== map) { mat.map = map; mat.needsUpdate = true; }
      mat.opacity = this.painted ? 1 : this.bgOpacity;
      mat.visible = !!map && mat.opacity > 0.001;
    }
    // (the photo's grass, paving and soil texture belongs to the photo)
    this.detailActive(this.close);
    if (this.detailPlane) this.detailPlane.visible = !!this.painted;
  }

  /** A sharper painting of part of the site (round the hole being looked at) over the painted map;
   * null takes it away. It shows only while the painted map does. */
  setPaintedDetail(d: { canvas: HTMLCanvasElement; rect: { x: number; y: number; width: number; height: number } } | null) {
    if (d === this.detailPainting) return;
    this.detailPainting = d;
    this.buildDetail();
    this.onChanged();
  }

  private buildDetail() {
    if (this.detailPlane) {
      this.group.remove(this.detailPlane);
      disposeObjectDeep(this.detailPlane);
      this.detailPlane = null;
    }
    const d = this.detailPainting, doc = this.lastDoc;
    if (!d || !doc) return;
    const tex = new THREE.CanvasTexture(d.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const plane = new THREE.Mesh(
      this.draped(doc, d.rect.x, d.rect.y, d.rect.width, d.rect.height, MAP_OVERLAY_OFFSET * 1.5),
      new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -5 })
    );
    // (the same ground as the painted map under it: its textures up close, its patches and real
    // colors; without them the sharper painting came in dull and flat over the sunlit ground)
    addGroundDetail(plane.material as THREE.Material, this.detail);
    plane.name = "terrain-detail-plane";
    plane.renderOrder = -0.5;
    plane.receiveShadow = true;
    plane.visible = !!this.painted;
    noRaycast(plane);
    this.detailPlane = plane;
    this.group.add(plane);
    // (faded in over a second, not swapped: the ground sharpening, never suddenly changing)
    const mat = plane.material as THREE.MeshLambertMaterial;
    mat.opacity = 0;
    const from = performance.now();
    const step = () => {
      if (this.detailPlane !== plane) return;
      mat.opacity = Math.min(1, (performance.now() - from) / 1000);
      this.onChanged();
      if (mat.opacity < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** The painted map draped over the ground in place of the photo (null: the photo again).
   * Resolves once it shows. */
  setPainted(url: string | null): Promise<void> {
    if (url === this.paintedUrl) return this.paintedReady;
    this.paintedUrl = url;
    this.painted?.dispose();
    this.painted = null;
    if (!url) {
      this.applyMap();
      this.onChanged();
      this.paintedReady = Promise.resolve();
      return this.paintedReady;
    }
    this.paintedReady = new Promise<void>(resolve => {
      const tex: THREE.Texture = new THREE.TextureLoader().load(url, () => {
        if (this.paintedUrl === url) {
          this.painted = tex;
          this.applyMap();
          this.onChanged();
        } else tex.dispose();
        resolve();
      }, undefined, () => resolve());
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      tex.minFilter = THREE.LinearMipmapLinearFilter;
    });
    return this.paintedReady;
  }

  private loadPhoto(url: string | null) {
    if (this.photo) this.photo.dispose();
    this.photo = null;
    this.setCover(null);
    if (!url) {
      this.applyMap();
      return;
    }
    const tex = new THREE.TextureLoader().load(url, () => {
      this.onChanged();
      // What the ground is made of (lawn, paving, soil), worked out in the background
      const image = tex.image as HTMLImageElement;
      setTimeout(() => {
        if (this.photo !== tex) return;
        void coverTexture(image, this.photoFt).then(cover => {
          if (this.photo !== tex) { cover?.dispose(); return; }
          this.setCover(cover);
          this.onChanged();
        });
      }, 0);
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.photo = tex;
    this.applyMap();
  }

  private setCover(cover: THREE.DataTexture | null) {
    this.detail.coverMap.value?.dispose();
    this.detail.coverMap.value = cover;
    this.detail.coverOn.value = cover ? 1 : 0;
    this.detailActive(this.close);
  }

  /**
   * Whether the view is close enough for the ground texture to show (far away it averages out to
   * nothing, so it is skipped: less work for each frame, which matters on a slow device).
   */
  detailActive(close: boolean, card = this.card) {
    this.close = close;
    // (without a graphics card the ground stays plain at every distance: each pixel's work is the processor's)
    this.card = card;
    // (on the photo and on the painted map alike: each takes the scans of what it shows)
    if (close && this.wantDetail) this.loadDetail();
    // (the painted map's colors say what each spot is; the photo's cover mask says it for the photo)
    this.detail.coverFromColor.value = this.painted || !this.detail.coverMap.value ? 1 : 0;
    // (the ground's own, where no photo or painted map covers it: real ground at any distance,
    // so its scans stay on however far the eye is)
    const map = this.painted ?? this.photo;
    const plain = !card || this.painted ? 0 : map ? 1 - Math.min(1, Math.max(0, this.bgOpacity)) : 1;
    this.detail.groundPlain.value = plain;
    if (plain > 0 && this.wantDetail) this.loadDetail();
    this.detail.groundDetail.value = (close || plain > 0) && this.wantDetail && this.detail.detailMap.value ? 1 : 0;
  }

  /** The scans, the first time the view comes close (a couple of megabytes, then kept). */
  private loadDetail() {
    if (this.detail.detailMap.value) return;
    void groundScans().then(sc => {
      if (!sc || this.detail.detailMap.value) return;
      this.detail.detailMap.value = sc.color;
      this.detail.detailNormal.value = sc.normal;
      this.detailActive(this.close);
      this.onChanged();
    });
  }

  /**
   * Painted ground into its two textures (color, and which pattern), over the whole plan. Only the
   * squares that changed since last time are rewritten, so brushing stays quick.
   */
  private updatePaint(doc: ViewDoc) {
    const paint = doc.groundPaint ?? {};
    const upf = doc.unitsPerFoot || 1;
    const cell = PAINT_CELL_FT * upf;
    // At most 2048 texels across (a huge plan groups several squares in one)
    const per = Math.max(1, Math.ceil(Math.max(doc.canvas.width, doc.canvas.height) / cell / 2048));
    const cols = Math.max(1, Math.ceil(doc.canvas.width / (cell * per))), rows = Math.max(1, Math.ceil(doc.canvas.height / (cell * per)));
    let g = this.paintGrid;
    const fresh = !g || g.cols !== cols || g.rows !== rows || g.per !== per || g.cell !== cell;
    if (!fresh && paint === this.paint) return false;
    const empty = !Object.keys(paint).length;
    if (empty) {
      this.paint = paint;
      if (!g) return false;
      this.detail.paintColorMap.value?.dispose();
      this.detail.paintCoverMap.value?.dispose();
      this.detail.paintColorMap.value = this.detail.paintCoverMap.value = null;
      this.detail.paintOn.value = 0;
      this.paintGrid = null;
      return true;
    }
    const colors = GROUND_MATERIALS.map(m => new THREE.Color(m.color));
    const write = (key: string, m: number) => {
      const [i, j] = key.split(",").map(Number);
      const ti = Math.floor(i / g!.per), tj = Math.floor(j / g!.per);
      if (ti < 0 || tj < 0 || ti >= g!.cols || tj >= g!.rows) return;
      const k = (tj * g!.cols + ti) * 4;
      const mat = m ? GROUND_MATERIALS[m - 1] : null;
      const c = m ? colors[m - 1] : null;
      g!.color[k] = c ? Math.round(c.r * 255) : 0;
      g!.color[k + 1] = c ? Math.round(c.g * 255) : 0;
      g!.color[k + 2] = c ? Math.round(c.b * 255) : 0;
      g!.color[k + 3] = m ? 255 : 0;
      for (let ch = 0; ch < 4; ch++) g!.cover[k + ch] = mat && mat.detail === ch ? 255 : 0;
    };
    if (fresh) {
      this.detail.paintColorMap.value?.dispose();
      this.detail.paintCoverMap.value?.dispose();
      g = this.paintGrid = { cols, rows, per, cell, color: new Uint8Array(cols * rows * 4), cover: new Uint8Array(cols * rows * 4) };
      const make = (data: Uint8Array, srgb: boolean) => {
        const t = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
        t.magFilter = THREE.LinearFilter;
        t.minFilter = THREE.LinearFilter;
        t.generateMipmaps = false;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        return t;
      };
      this.detail.paintColorMap.value = make(g.color, true);
      this.detail.paintCoverMap.value = make(g.cover, false);
      for (const key in paint) write(key, paint[key]);
    } else {
      for (const key in paint) if (this.paint[key] !== paint[key]) write(key, paint[key]);
      for (const key in this.paint) if (!(key in paint)) write(key, 0);
    }
    this.paint = paint;
    this.detail.paintColorMap.value!.needsUpdate = true;
    this.detail.paintCoverMap.value!.needsUpdate = true;
    this.detail.paintRect.value.set(0, 0, cols * cell * per, rows * cell * per);
    this.detail.paintOn.value = 1;
    this.loadDetail();
    return true;
  }

  private draped(doc: ViewDoc, x: number, y: number, w: number, d: number, lift: number) {
    const grid = doc.gridSize || 20;
    const geo = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / grid)), Math.max(1, Math.round(d / grid)));
    geo.rotateX(-Math.PI / 2);
    geo.translate(x + w / 2, 0, y + d / 2);
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.h(doc, pos.getX(i), pos.getZ(i)) + lift);
    geo.computeVertexNormals();
    return geo;
  }

  private redrape(doc: ViewDoc, mesh: THREE.Mesh | null, lift: number) {
    if (!mesh) return;
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.h(doc, pos.getX(i), pos.getZ(i)) + lift);
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeBoundingBox();
  }

  /** Where a ray first meets the terrain: the mesh's own triangles, but only those of the cells it
   * passes over (testing every triangle took most of each pointer move on a big site). */
  rayHit(worldRay: THREE.Ray): THREE.Vector3 | null {
    const mesh = this.terrain;
    if (!mesh) return null;
    const geo = mesh.geometry as THREE.PlaneGeometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const { widthSegments: nx, heightSegments: nz } = geo.parameters;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    mesh.updateMatrixWorld();
    const ray = worldRay.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
    const o = ray.origin, dir = ray.direction;
    // Along the ray: where it is over the site and between the lowest and highest ground
    let t0 = 0, t1 = Infinity;
    for (const [from, d, lo, hi] of [[o.x, dir.x, bb.min.x, bb.max.x], [o.y, dir.y, bb.min.y, bb.max.y], [o.z, dir.z, bb.min.z, bb.max.z]]) {
      if (Math.abs(d) < 1e-12) {
        if (from < lo || from > hi) return null;
        continue;
      }
      const a = (lo - from) / d, b = (hi - from) / d;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    // (not a number: a map with no size yet)
    if (!(t0 <= t1)) return null;
    // Cell by cell under it (a grid walk), nearest first
    const x0 = bb.min.x, z0 = bb.min.z, cw = (bb.max.x - x0) / nx, cd = (bb.max.z - z0) / nz;
    const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
    let ix = clamp(Math.floor((o.x + dir.x * t0 - x0) / cw), nx), iz = clamp(Math.floor((o.z + dir.z * t0 - z0) / cd), nz);
    const sx = dir.x > 0 ? 1 : -1, sz = dir.z > 0 ? 1 : -1;
    let nextX = Math.abs(dir.x) > 1e-12 ? (x0 + (ix + (sx > 0 ? 1 : 0)) * cw - o.x) / dir.x : Infinity;
    let nextZ = Math.abs(dir.z) > 1e-12 ? (z0 + (iz + (sz > 0 ? 1 : 0)) * cd - o.z) / dir.z : Infinity;
    const stepX = Math.abs(cw / dir.x), stepZ = Math.abs(cd / dir.z);
    const cull = (mesh.material as THREE.Material).side === THREE.FrontSide;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
    const hit = new THREE.Vector3(), best = new THREE.Vector3();
    for (let n = nx + nz + 2; n > 0; n--) {
      // (its two triangles, as the plane's geometry makes them)
      const a = ix + (nx + 1) * iz, b = ix + (nx + 1) * (iz + 1), c = ix + 1 + (nx + 1) * (iz + 1), d = ix + 1 + (nx + 1) * iz;
      A.fromBufferAttribute(pos, a); B.fromBufferAttribute(pos, b); C.fromBufferAttribute(pos, c); D.fromBufferAttribute(pos, d);
      let found = false, near = Infinity;
      for (const [p, q, r] of [[A, B, D], [B, C, D]]) {
        if (!ray.intersectTriangle(p, q, r, cull, hit)) continue;
        const t = hit.distanceToSquared(o);
        if (t < near) { near = t; best.copy(hit); found = true; }
      }
      if (found) return best.applyMatrix4(mesh.matrixWorld);
      if (Math.min(nextX, nextZ) > t1) break;
      if (nextX < nextZ) { ix += sx; nextX += stepX; } else { iz += sz; nextZ += stepZ; }
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) break;
    }
    // Over the ground but nothing met: every triangle, as three.js does (a ray straight through a
    // corner of the grid can slip between the cells walked)
    return new THREE.Raycaster(worldRay.origin, worldRay.direction).intersectObject(mesh, false)[0]?.point ?? null;
  }

  private colorTerrain(doc: ViewDoc) {
    if (!this.terrain) return;
    const geo = this.terrain.geometry;
    const pos = geo.getAttribute("position");
    let attr = geo.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!attr || attr.count !== pos.count) {
      attr = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
      geo.setAttribute("color", attr);
    }
    // The theme's ground color, a little lighter up high and darker down low so slopes read
    // (or the elevation colors, when the elevation overlay is on)
    // (darker than set, as much as the scene's light brightens it, and never yellower than a grass
    // green: the plan's ground a woodsy green, not a washed-out yellow)
    const hsl = new THREE.Color(doc.groundColor).getHSL({ h: 0, s: 0, l: 0 });
    const flat = new THREE.Color().setHSL(Math.max(hsl.h, 0.28), hsl.s * 0.85, hsl.l * 0.8).multiplyScalar(0.45);
    const c = new THREE.Color();
    const { min, relief } = doc.terrain;
    const tint = false;
    for (let i = 0; i < pos.count; i++) {
      const t = relief > 0.01 ? (pos.getY(i) - min) / relief : 0.5;
      if (tint && relief > 0.01) {
        const [r, g, b] = elevationColor(t);
        c.setRGB((r / 255) * 0.85, (g / 255) * 0.85, (b / 255) * 0.85, THREE.SRGBColorSpace);
      } else {
        // (by a share, not a step: low ground a little darker, never black)
        c.copy(flat).multiplyScalar(1 + (t - 0.5) * 0.35);
      }
      attr.setXYZ(i, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
  }

  private rebuild(doc: ViewDoc) {
    disposeObjectDeep(this.group);
    this.group.clear();
    this.skirt = null;
    this.sides = null;
    this.extras = new THREE.Group();
    this.group.add(this.extras);
    const { width, height } = doc.canvas;
    const terrain = new THREE.Mesh(
      this.draped(doc, 0, 0, width, height, 0),
      // (lit by the sun and the sky's light as the map over it is, never mirroring the sky: at a low
      // angle a bright sky washed the grass out to white)
      new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0 })
    );
    addGroundDetail(terrain.material as THREE.Material, this.detail);
    terrain.name = "terrain-mesh";
    terrain.receiveShadow = true;
    this.terrain = terrain;
    this.colorTerrain(doc);
    this.group.add(terrain);

    const r = doc.background.rect;
    const mapPlane = new THREE.Mesh(
      this.draped(doc, r.x, r.y, r.width, r.height, MAP_OVERLAY_OFFSET),
      new THREE.MeshLambertMaterial({
        color: 0xffffff,
        map: this.painted ?? this.photo,
        visible: !!(this.painted ?? this.photo) && (this.painted ? 1 : doc.background.opacity) > 0.001,
        // Drawn in the transparent pass so it lands on top of the (opaque) terrain under it.
        transparent: true,
        opacity: this.painted ? 1 : doc.background.opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4
      })
    );
    addGroundDetail(mapPlane.material as THREE.Material, this.detail);
    mapPlane.name = "terrain-map-plane";
    mapPlane.renderOrder = -1;
    mapPlane.receiveShadow = true;
    noRaycast(mapPlane);
    this.mapPlane = mapPlane;
    this.group.add(mapPlane);
    this.detailPlane = null;
    this.buildDetail();
  }

  /** The ground alone reshaped to heights being painted (nothing else on it moves till they're
   * the course's own). */
  previewHeights(heights: Record<string, number>) {
    if (!this.lastDoc || !this.terrain) return;
    this.reshape({ ...this.lastDoc, heights });
  }

  private reshape(doc: ViewDoc) {
    this.redrape(doc, this.terrain, 0);
    this.colorTerrain(doc);
    this.redrape(doc, this.mapPlane, MAP_OVERLAY_OFFSET);
    this.redrape(doc, this.detailPlane, MAP_OVERLAY_OFFSET * 1.5);
    this.redrape(doc, this.shade, MAP_OVERLAY_OFFSET * 2);
  }

  /**
   * Land around the site out to the horizon: the site's edge carried outward and eased to one
   * level, so the course sits in a landscape instead of on a block. Hidden on the flat map.
   */
  private buildSkirt(doc: ViewDoc, corners: number[][], grid: number) {
    const visible = this.skirt?.visible ?? false;
    if (this.skirt) {
      this.group.remove(this.skirt);
      disposeObjectDeep(this.skirt);
    }
    const { width: w, height: d } = doc.canvas;
    const span = Math.max(w, d);
    const edge: { x: number; y: number; h: number }[] = [];
    corners.forEach(([x1, y1], i) => {
      const [x2, y2] = corners[(i + 1) % 4];
      const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / Math.max(grid, span / 160)));
      for (let s = 0; s < steps; s++) {
        const x = x1 + ((x2 - x1) * s) / steps, y = y1 + ((y2 - y1) * s) / steps;
        edge.push({ x, y, h: this.h(doc, x, y) });
      }
    });
    const level = edge.reduce((a, e) => a + e.h, 0) / Math.max(1, edge.length);
    const cx = w / 2, cy = d / 2;
    // Rings outward: the edge itself, a short easing, then flat out to far away
    const rings = [{ out: 0, k: 1 }, { out: span * 0.12, k: 0.55 }, { out: span * 0.45, k: 0.12 }, { out: span * 1.6, k: 0 }, { out: span * 12, k: 0 }];
    const pos: number[] = [];
    for (const r of rings) {
      for (const e of edge) {
        const dx = e.x - cx, dy = e.y - cy, len = Math.hypot(dx, dy) || 1;
        // Out from the middle, squared off along the straight edges
        const ox = Math.abs(dx) / (w / 2) > Math.abs(dy) / (d / 2) - 1e-6 ? Math.sign(dx) : dx / len * 0.6;
        const oy = Math.abs(dy) / (d / 2) > Math.abs(dx) / (w / 2) - 1e-6 ? Math.sign(dy) : dy / len * 0.6;
        const ol = Math.hypot(ox, oy) || 1;
        pos.push(e.x + (ox / ol) * r.out, level + (e.h - level) * r.k - (r.out > 0 ? 0.05 : 0.02), e.y + (oy / ol) * r.out);
      }
    }
    const n = edge.length;
    const index: number[] = [];
    for (let r = 0; r < rings.length - 1; r++) {
      for (let i = 0; i < n; i++) {
        const a = r * n + i, b = r * n + ((i + 1) % n), c = (r + 1) * n + i, e = (r + 1) * n + ((i + 1) % n);
        index.push(a, c, b, b, c, e);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const skirt = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: new THREE.Color(doc.groundColor).offsetHSL(0, -0.04, -0.03), side: THREE.DoubleSide }));
    skirt.name = "landscape";
    skirt.receiveShadow = true;
    skirt.visible = visible;
    noRaycast(skirt);
    this.skirt = skirt;
    this.group.add(skirt);
  }

  /** The tilted and tee views: land out to the horizon instead of the map's cut-away block. */
  landscape(on: boolean) {
    if (this.skirt) this.skirt.visible = on;
    if (this.sides) this.sides.visible = !on;
  }

  private updateOverlays(doc: ViewDoc) {
    disposeObjectDeep(this.extras);
    this.extras.clear();
    this.colorTerrain(doc);
    const { width: w, height: d } = doc.canvas;
    const hasTerrain = doc.terrain.relief > 0.01;
    const grid = doc.gridSize || 20;

    // Grid: only on a blank plan (over a photo it is clutter).
    if (doc.showGrid && !doc.background.url) {
      const verts: number[] = [];
      const lift = 0.05;
      for (let x = 0; x <= w + 1e-6; x += grid) {
        for (let y = 0; y < d; y += grid) {
          const y2 = Math.min(d, y + grid);
          verts.push(x, this.h(doc, x, y) + lift, y, x, this.h(doc, x, y2) + lift, y2);
        }
      }
      for (let y = 0; y <= d + 1e-6; y += grid) {
        for (let x = 0; x < w; x += grid) {
          const x2 = Math.min(w, x + grid);
          verts.push(x, this.h(doc, x, y) + lift, y, x2, this.h(doc, x2, y) + lift, y);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      this.extras.add(noRaycast(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x64748b, transparent: true, opacity: 0.28, depthWrite: false }))));
    }

    // Site edge
    const edge: number[] = [];
    const corners = [[0, 0], [w, 0], [w, d], [0, d]];
    corners.forEach(([x1, y1], i) => {
      const [x2, y2] = corners[(i + 1) % 4];
      const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / grid));
      for (let s = 0; s < steps; s++) {
        const ax = x1 + ((x2 - x1) * s) / steps, ay = y1 + ((y2 - y1) * s) / steps;
        const bx = x1 + ((x2 - x1) * (s + 1)) / steps, by = y1 + ((y2 - y1) * (s + 1)) / steps;
        edge.push(ax, this.h(doc, ax, ay) + 0.1, ay, bx, this.h(doc, bx, by) + 0.1, by);
      }
    });
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(edge, 3));
    this.extras.add(noRaycast(new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x94a3b8 }))));

    // Cut-away sides on sloped sites
    if (hasTerrain) {
      const base = Math.min(0, doc.terrain.min) - Math.max(2, doc.terrain.relief * 0.08);
      const pos: number[] = [];
      corners.forEach(([x1, y1], i) => {
        const [x2, y2] = corners[(i + 1) % 4];
        const steps = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / grid));
        for (let s = 0; s < steps; s++) {
          const ax = x1 + ((x2 - x1) * s) / steps, ay = y1 + ((y2 - y1) * s) / steps;
          const bx = x1 + ((x2 - x1) * (s + 1)) / steps, by = y1 + ((y2 - y1) * (s + 1)) / steps;
          const ha = this.h(doc, ax, ay), hb = this.h(doc, bx, by);
          pos.push(ax, ha, ay, ax, base, ay, bx, hb, by, bx, hb, by, ax, base, ay, bx, base, by);
        }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      this.sides = noRaycast(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, side: THREE.DoubleSide })));
      this.extras.add(this.sides);
    } else this.sides = null;
    this.buildSkirt(doc, corners, grid);

    // Contour lines draped on the ground (every 5th brighter)
    if (doc.overlay !== "off" && doc.contours.segments.length) {
      const minor: number[] = [];
      const major: number[] = [];
      const interval = doc.contours.interval || 1;
      doc.contours.segments.forEach(s => {
        const isMajor = Math.abs(Math.round(s.level / interval)) % 5 === 0;
        (isMajor ? major : minor).push(s.x1, s.level + 0.25, s.y1, s.x2, s.level + 0.25, s.y2);
      });
      const color = doc.background.url ? 0xfff7e6 : 0x44341e;
      ([[minor, 0.45], [major, 0.9]] as [number[], number][]).forEach(([v, opacity]) => {
        if (!v.length) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
        this.extras.add(noRaycast(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))));
      });
    }

    // Hillshade draped over the photo
    if (this.shade) {
      this.shade = null;
    }
    if (doc.overlay === "shaded" && doc.shadeUrl && hasTerrain) {
      const tex = new THREE.TextureLoader().load(doc.shadeUrl, () => this.onChanged());
      tex.colorSpace = THREE.SRGBColorSpace;
      const shade = new THREE.Mesh(
        this.draped(doc, 0, 0, w, d, MAP_OVERLAY_OFFSET * 2),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: doc.background.url ? 0.5 : 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 })
      );
      shade.renderOrder = -1;
      noRaycast(shade);
      this.shade = shade;
      this.extras.add(shade);
    }
  }

  dispose() {
    disposeObjectDeep(this.group);
    this.photo?.dispose();
    this.painted?.dispose();
    this.setCover(null);
    this.detail.paintColorMap.value?.dispose();
    this.detail.paintCoverMap.value?.dispose();
  }
}
