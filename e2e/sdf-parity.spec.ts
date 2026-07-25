import { test, expect } from '@playwright/test';
import { generateSDFFunction } from '../src/worker/sdf/codegen';
import { evaluateSDF } from '../src/worker/sdf/evaluate';
import { computeBounds } from '../src/worker/sdf/bounds';
import type { SDFNode, Vec3 } from '../src/worker/sdf/types';

/**
 * Differential test between the two evaluators.
 *
 * The viewport ray-marches GLSL emitted by codegen.ts; the mesher and every
 * export walk the TypeScript evaluator in evaluate.ts.  Nothing checks that
 * they agree, and they have silently disagreed before — the ellipsoid had a
 * different formula on each side (#71), so the preview and the printed part
 * were different solids.  A test that only inspects one side cannot see it.
 *
 * The shader is rendered to a float texture, one z-slice at a time, and read
 * back for comparison against the CPU evaluator on the same grid.
 */

/** Bake the uniform array into the source, the way generateGLSL does. */
function bakedShader(root: SDFNode): string {
  const r = generateSDFFunction(root);
  let src = r.glsl;
  for (let i = r.paramCount - 1; i >= 0; i--) {
    const v = r.paramValues[i] ?? 0;
    src = src.split(`u_p[${i}]`).join(v.toFixed(9));
  }
  return src;
}

const FRAG = (sdfSource: string) => `precision highp float;
uniform float u_z;
uniform vec3 u_bbMin;
uniform vec3 u_bbMax;
uniform vec2 u_resolution;

${sdfSource}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 p = mix(u_bbMin, u_bbMax, vec3(uv, u_z));
  gl_FragColor = vec4(sdf(p), 0.0, 0.0, 1.0);
}`;

/**
 * Text is the one node where the two evaluators are written to disagree:
 * `codegen.ts` emits a box approximation ("GPU: box approximation (fast)"),
 * while `evaluate.ts` walks real glyph outlines when it has them.
 *
 * Today that costs nothing, because nothing populates the glyph data —
 * `ui.data.glyphPaths` has no producer in the repo, so `convert.ts` always
 * passes undefined and the CPU takes the same box fallback.  The divergence
 * is latent, and becomes real the moment someone wires glyph outlines up.
 *
 * This case supplies glyph data directly, so it fails now and will keep
 * failing until the shader grows a matching glyph path.  It is marked as an
 * expected failure rather than deleted: a green suite should not imply the two
 * agree about text when they do not.
 */
const TEXT_WITH_GLYPHS: SDFNode = {
  kind: 'text', text: 'L', size: 20, depth: 6, font: 'sans-serif',
  // A plain 'L': outlines that are nothing like the box the shader draws.
  glyphSegments: [
    { type: 'L', x0: 2, y0: 0, x1: 2, y1: 18 },
    { type: 'L', x0: 2, y0: 18, x1: 6, y1: 18 },
    { type: 'L', x0: 6, y0: 18, x1: 6, y1: 4 },
    { type: 'L', x0: 6, y0: 4, x1: 14, y1: 4 },
    { type: 'L', x0: 14, y0: 4, x1: 14, y1: 0 },
    { type: 'L', x0: 14, y0: 0, x1: 2, y1: 0 },
  ],
  glyphWidth: 16, glyphAscent: 18, glyphDescent: 0,
};

const CASES: [string, SDFNode, boolean?][] = [
  ['box', { kind: 'box', size: [30, 20, 40] }],
  ['sphere', { kind: 'sphere', radius: 14 }],
  ['cylinder', { kind: 'cylinder', radius: 10, height: 25 }],
  ['torus', { kind: 'torus', major: 14, minor: 4 }],
  ['capsule', { kind: 'capsule', radius: 6, height: 30 }],
  ['capsule degenerate', { kind: 'capsule', radius: 10, height: 5 }],
  ['ellipsoid', { kind: 'ellipsoid', size: [60, 10, 20] }],
  ['round(ellipsoid)', { kind: 'round', radius: 6, child: { kind: 'ellipsoid', size: [60, 10, 20] } }],
  ['shell', { kind: 'shell', thickness: 4, child: { kind: 'box', size: [30, 30, 30] } }],
  ['smooth union', {
    kind: 'union', k: 5,
    a: { kind: 'box', size: [20, 20, 20] },
    b: { kind: 'sphere', radius: 12 },
  }],
  ['subtract', {
    kind: 'subtract', k: 0,
    a: { kind: 'box', size: [30, 30, 30] },
    b: { kind: 'sphere', radius: 18 },
  }],
  ['non-uniform scale + rotation', {
    kind: 'transform', child: { kind: 'box', size: [20, 20, 30] },
    tx: 3, ty: -2, tz: 1, rx: 25, ry: -14, rz: 40, sx: 0.5, sy: 2.2, sz: 1.3,
  }],
  ['linearPattern with offset child', {
    kind: 'linearPattern', axis: [1, 0, 0], count: 3, spacing: 20,
    child: {
      kind: 'transform', child: { kind: 'box', size: [10, 10, 10] },
      tx: 37.5, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
    },
  }],
  ['text with glyph outlines (known divergence)', TEXT_WITH_GLYPHS, true],
  ['text without glyph data (the reachable case)', {
    kind: 'text', text: 'AB', size: 20, depth: 6, font: 'sans-serif',
  }],
  ['circularPattern spanning sectors', {
    kind: 'circularPattern', axis: [0, 1, 0], count: 6,
    child: {
      kind: 'transform', child: { kind: 'box', size: [60, 10, 10] },
      tx: 20, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
    },
  }],
];


const RES = 32;
const SLICES = [0.2, 0.5, 0.8];

test.describe('CPU and GPU evaluators agree', () => {
  for (const [name, tree, expectFail] of CASES) {
    test(name, async ({ page }) => {
      test.fail(!!expectFail, 'shader draws a box for text — see TEXT_WITH_GLYPHS');
      await page.goto('/');
      const bb = computeBounds(tree);
      const src = FRAG(bakedShader(tree));

      const gpu = await page.evaluate(
        ({ src, bbMin, bbMax, res, slices }) => {
          const canvas = document.createElement('canvas');
          canvas.width = res; canvas.height = res;
          const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
          if (!gl) return { error: 'no webgl context' };
          if (!gl.getExtension('OES_texture_float')) return { error: 'no OES_texture_float' };
          const cbf = gl.getExtension('WEBGL_color_buffer_float') || gl.getExtension('EXT_color_buffer_float');
          if (!cbf) return { error: 'no float colour buffer' };

          const compile = (type: number, s: string) => {
            const sh = gl.createShader(type)!;
            gl.shaderSource(sh, s); gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'compile failed');
            return sh;
          };
          const prog = gl.createProgram()!;
          try {
            gl.attachShader(prog, compile(gl.VERTEX_SHADER,
              'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }'));
            gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, src));
          } catch (e) {
            return { error: String(e) };
          }
          gl.linkProgram(prog);
          if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { error: gl.getProgramInfoLog(prog) || 'link failed' };
          gl.useProgram(prog);

          const buf = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
          const loc = gl.getAttribLocation(prog, 'a');
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, res, res, 0, gl.RGBA, gl.FLOAT, null);
          const fbo = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            return { error: 'framebuffer incomplete' };
          }
          gl.viewport(0, 0, res, res);

          gl.uniform3f(gl.getUniformLocation(prog, 'u_bbMin'), bbMin[0], bbMin[1], bbMin[2]);
          gl.uniform3f(gl.getUniformLocation(prog, 'u_bbMax'), bbMax[0], bbMax[1], bbMax[2]);
          gl.uniform2f(gl.getUniformLocation(prog, 'u_resolution'), res, res);

          const out: number[][] = [];
          for (const z of slices) {
            gl.uniform1f(gl.getUniformLocation(prog, 'u_z'), z);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const px = new Float32Array(res * res * 4);
            gl.readPixels(0, 0, res, res, gl.RGBA, gl.FLOAT, px);
            const slice: number[] = [];
            for (let i = 0; i < res * res; i++) slice.push(px[i * 4]);
            out.push(slice);
          }
          return { data: out };
        },
        { src, bbMin: bb.min, bbMax: bb.max, res: RES, slices: SLICES },
      );

      expect(gpu.error, `GPU setup failed: ${gpu.error}`).toBeUndefined();
      const data = gpu.data!;

      const ext: Vec3 = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
      const scale = Math.max(ext[0], ext[1], ext[2]);
      let worst = 0, worstAt = '';
      let signMismatches = 0;

      for (let s = 0; s < SLICES.length; s++) {
        for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
          // gl_FragCoord is pixel-centred, so sample at (i+0.5)/res.
          const p: Vec3 = [
            bb.min[0] + ext[0] * ((i + 0.5) / RES),
            bb.min[1] + ext[1] * ((j + 0.5) / RES),
            bb.min[2] + ext[2] * SLICES[s],
          ];
          const cpu = evaluateSDF(tree, p);
          const got = data[s][j * RES + i];
          if (!isFinite(cpu) || !isFinite(got)) continue;
          const diff = Math.abs(cpu - got);
          if (diff > worst) { worst = diff; worstAt = `(${p.map((v) => v.toFixed(2)).join(', ')})`; }
          // A sign flip is what actually changes the rendered solid.
          if ((cpu < 0) !== (got < 0) && diff > scale * 1e-4) signMismatches++;
        }
      }

      expect(signMismatches, `${signMismatches} sign disagreements`).toBe(0);
      // highp float is ~1e-7 relative; allow a little more for accumulated ops.
      expect(worst, `worst |cpu - gpu| = ${worst} at ${worstAt}`).toBeLessThan(scale * 2e-3);
    });
  }
});
