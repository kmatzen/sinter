import type { BBox } from './types';

const VERT_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export class GPUEvaluator {
  private gl: WebGL2RenderingContext;
  private canvas: OffscreenCanvas;
  private quadBuffer: WebGLBuffer;

  constructor() {
    this.canvas = new OffscreenCanvas(1, 1);
    const gl = this.canvas.getContext('webgl2', { antialias: false });
    if (!gl) throw new Error('WebGL2 not available on OffscreenCanvas');
    this.gl = gl;

    // Check for float texture support
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('EXT_color_buffer_float not available');

    // Create fullscreen quad
    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  }

  evaluate(fragmentSource: string, bbox: BBox, resolution: number): Float32Array {
    const gl = this.gl;
    const res = resolution;

    // Resize canvas to match grid slice dimensions
    this.canvas.width = res;
    this.canvas.height = res;
    gl.viewport(0, 0, res, res);

    // Compile shaders
    const vertShader = this.compileShader(gl.VERTEX_SHADER, VERT_SHADER);
    const fragShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram()!;
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      gl.deleteShader(vertShader);
      gl.deleteShader(fragShader);
      throw new Error('Shader link error: ' + log);
    }

    gl.useProgram(program);

    // Set up vertex attribute
    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // Set uniforms
    const uZ = gl.getUniformLocation(program, 'u_z');
    const uBBMin = gl.getUniformLocation(program, 'u_bbMin');
    const uBBMax = gl.getUniformLocation(program, 'u_bbMax');
    const uRes = gl.getUniformLocation(program, 'u_resolution');

    gl.uniform3f(uBBMin, bbox.min[0], bbox.min[1], bbox.min[2]);
    gl.uniform3f(uBBMax, bbox.max[0], bbox.max[1], bbox.max[2]);
    gl.uniform2f(uRes, res, res);

    // Create framebuffer with float texture
    const fbo = gl.createFramebuffer()!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, res, res, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    // Evaluate each Z-slice
    const grid = new Float32Array(res * res * res);
    const sliceBuffer = new Float32Array(res * res * 4); // RGBA

    for (let z = 0; z < res; z++) {
      const zNorm = (z + 0.5) / res;
      gl.uniform1f(uZ, zNorm);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Read back this slice
      gl.readPixels(0, 0, res, res, gl.RGBA, gl.FLOAT, sliceBuffer);

      // Extract R channel (the SDF distance)
      const offset = z * res * res;
      for (let i = 0; i < res * res; i++) {
        grid[offset + i] = sliceBuffer[i * 4];
      }
    }

    // Cleanup
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    gl.deleteProgram(program);
    gl.deleteShader(vertShader);
    gl.deleteShader(fragShader);

    return grid;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('Shader compile error: ' + log);
    }
    return shader;
  }
}
