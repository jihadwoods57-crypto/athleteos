/* OnStandard — the performance dial, in 3D.
   Raw WebGL2, no dependencies. A machined dark ring with the score arc lit in the
   brand gradient (green -> teal -> blue), a white head that travels the arc, and a
   soft additive glow pass standing in for bloom. Reads progress from the shared
   dial state driven by site.js, so number and arc never disagree.

   Budget: ~11KB source, one geometry build, 3 draw passes + 1 sprite. DPR capped.
   Pauses off-screen and on hidden tab. If anything throws, site.js keeps the SVG. */

const SPAN = 306 * Math.PI / 180;
const PHI0 = -117 * Math.PI / 180;
const TUBE = 0.088;

/* ---------- tiny mat4 ---------- */
const M = {
  ident: () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
    }
    return o;
  },
  persp(fov, asp, n, f) {
    const t = 1 / Math.tan(fov / 2);
    return new Float32Array([t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)/(n-f),-1, 0,0,2*f*n/(n-f),0]);
  },
  trans(x, y, z) { const m = M.ident(); m[12]=x; m[13]=y; m[14]=z; return m; },
  rotX(a) { const c=Math.cos(a), s=Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); },
  rotY(a) { const c=Math.cos(a), s=Math.sin(a); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); },
  scale(k) { const m = M.ident(); m[0]=k; m[5]=k; m[10]=k; return m; },
};

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aS;
uniform mat4 uModel, uVP;
uniform float uFat;              // tube inflation for the glow pass
out vec3 vN; out vec3 vW; out float vS;
void main() {
  vec3 p = aPos + aNormal * uFat;
  vec4 w = uModel * vec4(p, 1.0);
  vW = w.xyz;
  vN = mat3(uModel) * aNormal;
  vS = aS;
  gl_Position = uVP * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vW; in float vS;
uniform float uP;                // progress 0..1
uniform int uMode;               // 0 track · 1 lit arc · 2 glow arc · 3 head
uniform vec3 uCam;
uniform float uTime;
out vec4 o;

vec3 grad(float t) {
  vec3 g = vec3(0.204, 0.827, 0.600);   // #34D399
  vec3 c = vec3(0.133, 0.827, 0.933);   // #22D3EE
  vec3 b = vec3(0.231, 0.510, 0.965);   // #3B82F6
  return t < 0.55 ? mix(g, c, t / 0.55) : mix(c, b, (t - 0.55) / 0.45);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 L = normalize(vec3(0.55, 0.85, 0.6));
  float dif = max(dot(N, L), 0.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);

  if (uMode == 0) {
    // machined dark steel track
    vec3 base = vec3(0.075, 0.100, 0.150);
    vec3 col = base * (0.55 + 0.9 * dif) + vec3(0.28, 0.38, 0.58) * fres * 0.5;
    // faint anticipation of the gradient where the arc will land
    col += grad(vS) * 0.03;
    o = vec4(col, 1.0);
  } else if (uMode == 1) {
    float edge = 1.0 - smoothstep(uP - 0.0035, uP + 0.0035, vS);
    if (edge <= 0.0) discard;
    vec3 g = grad(vS);
    vec3 col = g * (0.95 + 0.22 * dif) + vec3(1.0) * fres * 0.10;
    // slow breath along the lit arc once the draw settles
    col *= 1.0 + 0.03 * sin(uTime * 1.4 + vS * 9.0);
    o = vec4(col, edge);
  } else if (uMode == 2) {
    float edge = 1.0 - smoothstep(uP - 0.01, uP + 0.005, vS);
    if (edge <= 0.0) discard;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 1.3);
    o = vec4(grad(vS) * 0.30 * edge * rim, 0.0);   // additive halo, brightest at the shell edge
  } else {
    // head: hot white core, cool falloff
    vec3 col = vec3(1.0) * (0.86 + 0.3 * dif) + vec3(0.6, 0.8, 1.0) * fres * 0.6;
    o = vec4(col, 1.0);
  }
}`;

const SPRITE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aQ;
uniform mat4 uVP;
uniform vec3 uPos;
uniform float uSize;
out vec2 vQ;
void main() {
  vQ = aQ;
  vec4 c = uVP * vec4(uPos, 1.0);
  gl_Position = c + vec4(aQ * uSize * vec2(1.0, 1.0), 0.0, 0.0) * c.w;
}`;

const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 vQ;
uniform vec3 uCol;
uniform float uA;
out vec4 o;
void main() {
  float d = length(vQ);
  float a = exp(-d * d * 5.0) * uA;
  o = vec4(uCol * a, 0.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

/* arc tube: position, normal, s-along-arc */
function buildTube(segU, segV) {
  const pos = [], nor = [], ss = [], idx = [];
  for (let i = 0; i <= segU; i++) {
    const s = i / segU;
    const phi = PHI0 - SPAN * s;
    const cx = Math.cos(phi), cy = Math.sin(phi);
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * Math.PI * 2;
      const nv = [Math.cos(v) * cx, Math.cos(v) * cy, Math.sin(v)];
      pos.push(cx + TUBE * nv[0], cy + TUBE * nv[1], TUBE * nv[2]);
      nor.push(nv[0], nv[1], nv[2]);
      ss.push(s);
    }
  }
  const w = segV + 1;
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
    const a = i * w + j, b = a + w;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { pos, nor, ss, idx };
}

/* small uv-sphere; s constant (passed per-draw via aS buffer fill) */
function buildSphere(rad, lat, lon, sVal) {
  const pos = [], nor = [], ss = [], idx = [];
  for (let i = 0; i <= lat; i++) {
    const th = (i / lat) * Math.PI;
    for (let j = 0; j <= lon; j++) {
      const ph = (j / lon) * Math.PI * 2;
      const n = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      pos.push(n[0] * rad, n[1] * rad, n[2] * rad);
      nor.push(n[0], n[1], n[2]);
      ss.push(sVal);
    }
  }
  const w = lon + 1;
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
    const a = i * w + j, b = a + w;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { pos, nor, ss, idx };
}

function upload(gl, mesh) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = (data, loc, size) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  buf(mesh.pos, 0, 3); buf(mesh.nor, 1, 3); buf(mesh.ss, 2, 1);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, n: mesh.idx.length };
}

export function mount(canvas, stage, dial) {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' });
  if (!gl) return;

  const prog = program(gl, VS, FS);
  const sprite = program(gl, SPRITE_VS, SPRITE_FS);
  const U = (p, n) => gl.getUniformLocation(p, n);
  const u = {
    model: U(prog, 'uModel'), vp: U(prog, 'uVP'), fat: U(prog, 'uFat'),
    p: U(prog, 'uP'), mode: U(prog, 'uMode'), cam: U(prog, 'uCam'), time: U(prog, 'uTime'),
    svp: U(sprite, 'uVP'), spos: U(sprite, 'uPos'), ssize: U(sprite, 'uSize'),
    scol: U(sprite, 'uCol'), sa: U(sprite, 'uA'),
  };

  const tube = upload(gl, buildTube(240, 26));
  const capA = upload(gl, buildSphere(TUBE, 12, 16, 0));       // fixed cap at arc start
  const capB = upload(gl, buildSphere(TUBE, 12, 16, 1));       // fixed cap at arc end (track)
  const head = upload(gl, buildSphere(TUBE * 1.28, 16, 22, 0)); // traveling head

  // sprite quad
  const qvao = gl.createVertexArray();
  gl.bindVertexArray(qvao);
  const qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  /* sizing */
  let vp = M.ident(), cam = [0, 0, 4.4];
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const proj = M.persp(0.55, w / h, 0.1, 20);
    const view = M.trans(-cam[0], -cam[1], -cam[2]);
    vp = M.mul(proj, view);
  };
  new ResizeObserver(resize).observe(canvas);

  /* pointer parallax (window-level, passive) */
  let px = 0, py = 0, tx = 0, ty = 0;
  addEventListener('pointermove', (e) => {
    tx = (e.clientX / innerWidth - 0.5) * 2;
    ty = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  /* visibility */
  let visible = true, hidden = false;
  new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }).observe(stage);
  document.addEventListener('visibilitychange', () => { hidden = document.hidden; });

  const phiAt = (s) => PHI0 - SPAN * s;

  let raf = 0;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (!visible || hidden) return;
    const t = now / 1000;
    px += (tx - px) * 0.05; py += (ty - py) * 0.05;

    const rotY = 0.06 + Math.sin(t * 0.35) * 0.05 + px * 0.16;
    const rotX = -0.40 + Math.sin(t * 0.23) * 0.03 + py * 0.1;
    const model = M.mul(M.rotX(rotX), M.mul(M.rotY(rotY), M.scale(0.88)));

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    gl.useProgram(prog);
    gl.uniformMatrix4fv(u.model, false, model);
    gl.uniformMatrix4fv(u.vp, false, vp);
    gl.uniform3fv(u.cam, cam);
    gl.uniform1f(u.p, dial.p);
    gl.uniform1f(u.time, t);
    gl.uniform1f(u.fat, 0);

    // 1 · track
    gl.uniform1i(u.mode, 0);
    gl.bindVertexArray(tube.vao); gl.drawElements(gl.TRIANGLES, tube.n, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(capA.vao); // caps drawn translated via model tweak below
    // caps: cheap — reuse shader; translate by rebuilding model each time
    const capModel = (s) => {
      const phi = phiAt(s);
      const tm = M.trans(Math.cos(phi), Math.sin(phi), 0);
      return M.mul(model, tm);
    };
    gl.uniformMatrix4fv(u.model, false, capModel(0));
    gl.drawElements(gl.TRIANGLES, capA.n, gl.UNSIGNED_SHORT, 0);
    gl.uniformMatrix4fv(u.model, false, capModel(1));
    gl.bindVertexArray(capB.vao);
    gl.drawElements(gl.TRIANGLES, capB.n, gl.UNSIGNED_SHORT, 0);
    gl.uniformMatrix4fv(u.model, false, model);

    // 2 · lit arc (slightly fatter, alpha edge)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(u.mode, 1);
    gl.uniform1f(u.fat, 0.006);
    gl.bindVertexArray(tube.vao);
    gl.drawElements(gl.TRIANGLES, tube.n, gl.UNSIGNED_SHORT, 0);

    // 3 · glow pass (additive, inflated, depth-read only)
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.uniform1i(u.mode, 2);
    gl.uniform1f(u.fat, 0.055);
    gl.drawElements(gl.TRIANGLES, tube.n, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);

    // 4 · head sphere + halo
    if (dial.p > 0.001) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const phi = phiAt(dial.p);
      gl.uniform1i(u.mode, 3);
      gl.uniform1f(u.fat, 0);
      gl.uniformMatrix4fv(u.model, false, M.mul(model, M.trans(Math.cos(phi), Math.sin(phi), 0)));
      gl.bindVertexArray(head.vao);
      gl.drawElements(gl.TRIANGLES, head.n, gl.UNSIGNED_SHORT, 0);

      // halo sprite at head (world position through model)
      const hx = Math.cos(phi) * 0.88, hy = Math.sin(phi) * 0.88;
      const cX = Math.cos(rotY), sX = Math.sin(rotY);
      const cY = Math.cos(rotX), sY = Math.sin(rotX);
      // model = rotX * rotY * scale — apply to (hx, hy, 0)
      let wx = cX * hx, wy = hy, wz = -sX * hx;
      const wy2 = cY * wy - sY * wz, wz2 = sY * wy + cY * wz;
      gl.useProgram(sprite);
      gl.uniformMatrix4fv(u.svp, false, vp);
      gl.uniform3f(u.spos, wx, wy2, wz2);
      gl.uniform1f(u.ssize, 0.11);
      gl.uniform3f(u.scol, 0.75, 0.9, 1.0);
      gl.uniform1f(u.sa, 0.55 + 0.08 * Math.sin(t * 2.2));
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.bindVertexArray(qvao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
  };

  resize();
  stage.classList.add('gl');
  raf = requestAnimationFrame(frame);
}
