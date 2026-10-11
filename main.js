/* ============================================================================
 *  姻缘祈福树 · 夜色古院   (main.js)
 *  ---------------------------------------------------------------------------
 *  纯程序化生成，不加载任何外部模型 / 贴图：
 *    · 分形递归生成的粗糙老树干 + 遒劲枝杈（顶点置换 + 程序化法线/粗糙度贴图）
 *    · 程序化花团、地面花瓣、空中盘旋飘落的花瓣
 *    · 程序化挂件：红绸带 / 许愿姻缘牌（带淡淡文字纹理）/ 黄铜同心锁 /
 *      小红福袋 / 迷你中式纸灯笼
 *    · 夜色中式庭院：青石板地面、廊柱、屋面、格栅窗、阶石、廊下灯笼
 *    · 主光=树上灯笼的暖黄柔光；环境极暗；Bloom 辉光 + 朦胧体积光柱
 *    · 点击后生长 11.5 秒；长成后微风永续循环（幅度轻柔）
 *
 *  依赖：three.js 官方 CDN（unpkg），由 index.html 里的 import map 解析裸模块名。
 *  写法说明：本文件是「经典脚本」，用动态 import() 载入 CDN 上的 ES module。
 *           这样无论双击打开（file://）、本地起服务，还是 GitHub Pages 都能运行。
 *
 *  调试参数（可选）：?grow=0.65 直接跳到生长进度 0.65 并停住；?still=1 隐藏提示
 * ========================================================================== */

(function () {
  'use strict';

  /* --- 依赖：从官方 CDN 动态载入（import map 负责把 'three' 解析成 CDN 地址） --- */
  const ready = (async () => {
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const { EffectComposer } = await import('three/addons/postprocessing/EffectComposer.js');
    const { RenderPass } = await import('three/addons/postprocessing/RenderPass.js');
    const { UnrealBloomPass } = await import('three/addons/postprocessing/UnrealBloomPass.js');
    const { OutputPass } = await import('three/addons/postprocessing/OutputPass.js');
    const { ShaderPass } = await import('three/addons/postprocessing/ShaderPass.js');
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    return { THREE, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass, mergeGeometries };
  })();

  ready.then((mods) => {
    const { THREE, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass, mergeGeometries } = mods;

    const TAU = Math.PI * 2;
    const clamp = THREE.MathUtils.clamp;
    const lerp = THREE.MathUtils.lerp;

    const CFG = {
      seed: 20240214,
      growDuration: 11.5,      // 生长总时长（秒）—— 需求 9~13s
      windBase: 0.115,         // 微风强度（刻意压小）
      maxOrder: 7,             // 分形层数
        };

    const QUERY = new URLSearchParams(location.search);
    const DEBUG_GROW = QUERY.has('grow') ? clamp(parseFloat(QUERY.get('grow')) || 0, 0, 1) : null;
    const STILL = QUERY.get('still') === '1';

    /* ==========================================================================
     * 0. 随机数与噪声
     * ======================================================================== */

    function mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), 1 | t);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const rnd = mulberry32(CFG.seed);
    const rand = (a = 0, b = 1) => a + (b - a) * rnd();
    const randInt = (a, b) => Math.floor(rand(a, b + 1));

    function hash2i(x, y, s) {
      let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 362437);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    /** 普通值噪声 */
    function noise2(x, y, s) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = hash2i(xi, yi, s), b = hash2i(xi + 1, yi, s);
      const c = hash2i(xi, yi + 1, s), d = hash2i(xi + 1, yi + 1, s);
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }
    /** 分形叠加 */
    function fbm(x, y, oct = 4, s = 1) {
      let sum = 0, amp = 0.5, norm = 0, fx = x, fy = y;
      for (let i = 0; i < oct; i++) {
        sum += amp * noise2(fx, fy, s + i * 37);
        norm += amp; amp *= 0.5; fx *= 2.03; fy *= 2.01;
      }
      return sum / norm;
    }
    /** 可无缝平铺的值噪声：u,v ∈ [0,1]，px,py 为整数周期 */
    function noiseTile(x, y, px, py, s) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const w = (i, p) => ((i % p) + p) % p;
      const x0 = w(xi, px), x1 = w(xi + 1, px), y0 = w(yi, py), y1 = w(yi + 1, py);
      const a = hash2i(x0, y0, s), b = hash2i(x1, y0, s);
      const c = hash2i(x0, y1, s), d = hash2i(x1, y1, s);
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }
    function fbmTile(u, v, sx, sy, oct = 4, s = 1) {
      let sum = 0, amp = 0.5, norm = 0, fx = sx, fy = sy;
      for (let i = 0; i < oct; i++) {
        sum += amp * noiseTile(u * fx, v * fy, fx, fy, s + i * 53);
        norm += amp; amp *= 0.5; fx *= 2; fy *= 2;
      }
      return sum / norm;
    }

    /* ==========================================================================
     * 1. 渲染器 / 场景 / 相机 / 控制器 / 后期
     * ======================================================================== */

    const app = document.getElementById('app');

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    app.appendChild(renderer.domElement);

    const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020408);
    scene.fog = new THREE.FogExp2(0x03050c, 0.0185);   // 夜色朦胧（压得很淡）

    const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 400);
    const CAM_A = { pos: new THREE.Vector3(0.0, 0.74, 2.45), tgt: new THREE.Vector3(0, 0.34, 0) };
    const CAM_B = { pos: new THREE.Vector3(1.1, 5.5, 14.6), tgt: new THREE.Vector3(0, 4.85, 0) };
    camera.position.copy(CAM_A.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(CAM_A.tgt);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.62;
    controls.zoomSpeed = 0.75;
    controls.enablePan = false;
    controls.minDistance = 3.2;
    controls.maxDistance = 19.5;
    controls.minPolarAngle = 0.22;
    controls.maxPolarAngle = 1.42;
    controls.update();

    let userMoved = false;
    renderer.domElement.addEventListener('pointermove', (e) => { if (e.buttons) userMoved = true; });
    renderer.domElement.addEventListener('wheel', () => { userMoved = true; }, { passive: true });

    /* ---------- 后期：Bloom 辉光 + 暗角调色 ---------- */
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.58,   // strength —— 只让灯笼/高光泛光，不糊画面
      0.44,   // radius
      0.72    // threshold
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const VignetteShader = {
      uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.72 }, uCool: { value: 0.24 } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uAmount;
        uniform float uCool;
        varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          vec2 p = (vUv - 0.5) * 2.0;
          float v = smoothstep(1.62, 0.42, length(p * vec2(1.0, 0.98)));
          c.rgb *= mix(1.0, v, uAmount);
          // 暗部偏冷，让暖光更突出
          c.rgb = mix(c.rgb, c.rgb * vec3(0.84, 0.92, 1.14), uCool);
          gl_FragColor = c;
        }`
    };
    composer.addPass(new ShaderPass(VignetteShader));

    /* ---------- 环境反射（很暗的夜空 + 一处暖光团），供黄铜件等金属使用 ---------- */
    {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const envMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          cTop: { value: new THREE.Color(0x0b1526) },
          cBot: { value: new THREE.Color(0x020306) },
          cWarm: { value: new THREE.Color(0xff8a38) },
        },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */`
          uniform vec3 cTop; uniform vec3 cBot; uniform vec3 cWarm;
          varying vec3 vP;
          void main(){
            vec3 d = normalize(vP);
            vec3 c = mix(cBot, cTop, pow(d.y * 0.5 + 0.5, 1.35));
            float w = pow(max(0.0, dot(d, normalize(vec3(0.0, 0.30, 1.0)))), 5.0);
            c += cWarm * w * 0.55;
            gl_FragColor = vec4(c, 1.0);
          }`
      });
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), envMat));
      scene.environment = pmrem.fromScene(envScene, 0.02).texture;
      pmrem.dispose();
    }

    /* ==========================================================================
     * 2. 程序化贴图
     * ======================================================================== */

    function cvs(w, h) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
    function tex(canvas, srgb, repeat = 1) {
      const t = new THREE.CanvasTexture(canvas);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = MAX_ANISO;
      t.needsUpdate = true;
      return t;
    }
    /** 高度场 → 切线空间法线贴图 */
    function heightToNormal(hgt, S, strength) {
      const c = cvs(S, S);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const xm = (x - 1 + S) % S, xp = (x + 1) % S;
          const ym = (y - 1 + S) % S, yp = (y + 1) % S;
          const dHdu = hgt[y * S + xp] - hgt[y * S + xm];
          const dHdv = -(hgt[yp * S + x] - hgt[ym * S + x]);   // canvas y 向下 = v 减小
          const nx = -dHdu * strength, ny = -dHdv * strength, nz = 1;
          const l = Math.hypot(nx, ny, nz);
          const i4 = (y * S + x) * 4;
          img.data[i4] = (nx / l * 0.5 + 0.5) * 255;
          img.data[i4 + 1] = (ny / l * 0.5 + 0.5) * 255;
          img.data[i4 + 2] = (nz / l * 0.5 + 0.5) * 255;
          img.data[i4 + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return c;
    }

    /* ---------- 2.1 老树皮：颜色 / 法线 / 粗糙度 ---------- */
    function buildBark() {
      const S = 512;
      const hgt = new Float32Array(S * S);
      const cCol = cvs(S, S), cRgh = cvs(S, S);
      const ctxC = cCol.getContext('2d'), ctxR = cRgh.getContext('2d');
      const imgC = ctxC.createImageData(S, S), imgR = ctxR.createImageData(S, S);

      for (let y = 0; y < S; y++) {
        const v = y / S;
        for (let x = 0; x < S; x++) {
          const u = x / S;
          // 树皮的高度场刻意做成“大尺度为主”：远景/近景都能看见棱与沟
          const plate = fbmTile(u, v, 4, 2, 4, 11);                       // 大块树皮板
          const wob = fbmTile(u, v, 3, 1, 2, 21) * 4.0;                   // 棱条的摆动
          const ribs = Math.pow(Math.abs(Math.sin(u * TAU * 6.0 + wob)), 0.65);  // 6 条纵向棱
          const crack = Math.pow(1 - Math.abs(fbmTile(u, v, 5, 1, 3, 31) * 2 - 1), 3.0);   // 纵向深沟
          const crack2 = Math.pow(1 - Math.abs(fbmTile(u, v, 11, 3, 2, 97) * 2 - 1), 3.2) * 0.6;
          const fine = fbmTile(u, v, 40, 12, 3, 47);                      // 细颗粒

          let h = plate * 0.52 + ribs * 0.13 + fine * 0.08 - crack * 0.20 - crack2 * 0.10;
          h = clamp(h, 0, 1);
          hgt[y * S + x] = h;

          // 颜色：深褐树皮，裂隙里更暗更冷，凸起处略暖（整体保持“夜色里的暗褐”，但不能死黑）
          const shade = 0.34 + 1.05 * h;
          let r = 122 * shade, g = 94 * shade, b = 74 * shade;
          const moss = Math.max(0, 0.42 - h) * 1.15;   // 阴面苔痕（很低调）
          r = r * (1 - moss * 0.50) + 64 * moss;
          g = g * (1 - moss * 0.20) + 86 * moss;
          b = b * (1 - moss * 0.05) + 60 * moss;
          const grain = (hash2i(x, y, 5) - 0.5) * 10;
          const i4 = (y * S + x) * 4;
          imgC.data[i4] = clamp(r + grain, 0, 255);
          imgC.data[i4 + 1] = clamp(g + grain, 0, 255);
          imgC.data[i4 + 2] = clamp(b + grain, 0, 255);
          imgC.data[i4 + 3] = 255;

          const ro = clamp(172 + 76 * (1 - h) + (hash2i(x, y, 9) - 0.5) * 26, 0, 255);
          imgR.data[i4] = ro; imgR.data[i4 + 1] = ro; imgR.data[i4 + 2] = ro; imgR.data[i4 + 3] = 255;
        }
      }
      ctxC.putImageData(imgC, 0, 0);
      ctxR.putImageData(imgR, 0, 0);
      return {
        map: tex(cCol, true),
        normal: tex(heightToNormal(hgt, S, 6.5), false),
        rough: tex(cRgh, false),
      };
    }

    /* ---------- 2.2 青石板地面 ---------- */
    function buildStone() {
      const S = 512, TILE = 4, TS = S / TILE;
      const hgt = new Float32Array(S * S);
      const cCol = cvs(S, S), cRgh = cvs(S, S);
      const ctxC = cCol.getContext('2d'), ctxR = cRgh.getContext('2d');
      const imgC = ctxC.createImageData(S, S), imgR = ctxR.createImageData(S, S);

      // 每块板的基色略有差异
      const tileCol = [];
      for (let i = 0; i < TILE * TILE; i++) {
        const t = rand(-16, 14);
        tileCol.push([98 + t, 102 + t, 111 + t * 0.9]);
      }
      const GROUT = 5;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
          const lx = x - tx * TS, ly = y - ty * TS;
          const edge = Math.min(lx, ly, TS - 1 - lx, TS - 1 - ly);
          const g = clamp((GROUT - edge) / GROUT, 0, 1);          // 0=板面 1=缝
          const n = fbm(x / S, y / S, 5, 13);
          const fine = fbm(x / S, y / S, 3, 29);
          let h = 0.62 + n * 0.30 - fine * 0.10;
          h = lerp(h, 0.16, g);                                    // 缝隙下沉
          hgt[y * S + x] = h;

          const base = tileCol[ty * TILE + tx];
          const sp = 0.86 + n * 0.30;                              // 斑驳
          let r = base[0] * sp, gg = base[1] * sp, b = base[2] * sp;
          if (g > 0) { r = lerp(r, 44, g); gg = lerp(gg, 46, g); b = lerp(b, 52, g); }
          const i4 = (y * S + x) * 4;
          imgC.data[i4] = clamp(r, 0, 255);
          imgC.data[i4 + 1] = clamp(gg, 0, 255);
          imgC.data[i4 + 2] = clamp(b, 0, 255);
          imgC.data[i4 + 3] = 255;

          const ro = clamp(196 + 44 * (1 - h) + (hash2i(x, y, 3) - 0.5) * 22, 0, 255);
          imgR.data[i4] = ro; imgR.data[i4 + 1] = ro; imgR.data[i4 + 2] = ro; imgR.data[i4 + 3] = 255;
        }
      }
      ctxC.putImageData(imgC, 0, 0);
      ctxR.putImageData(imgR, 0, 0);
      return {
        map: tex(cCol, true, 6),
        normal: tex(heightToNormal(hgt, S, 2.6), false, 6),
        rough: tex(cRgh, false, 6),
      };
    }

    /* ---------- 2.3 花瓣 ---------- */
    function buildPetalTex() {
      const S = 128;
      const c = cvs(S, S);
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, S, S);
      const g = ctx.createRadialGradient(S * 0.5, S * 0.62, 3, S * 0.5, S * 0.5, S * 0.56);
      g.addColorStop(0.00, '#ff7a52');
      g.addColorStop(0.45, '#ee2f24');
      g.addColorStop(1.00, '#a8111b');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(S * 0.50, S * 0.93);
      ctx.bezierCurveTo(S * 0.03, S * 0.66, S * 0.10, S * 0.10, S * 0.50, S * 0.26);
      ctx.bezierCurveTo(S * 0.90, S * 0.10, S * 0.97, S * 0.66, S * 0.50, S * 0.93);
      ctx.closePath();
      ctx.fill();
      // 淡淡的瓣脉
      ctx.strokeStyle = 'rgba(255,190,160,0.22)';
      ctx.lineWidth = 1.6;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(S * 0.5, S * 0.86);
        ctx.quadraticCurveTo(S * (0.5 + i * 0.11), S * 0.5, S * (0.5 + i * 0.05), S * 0.3);
        ctx.stroke();
      }
      return tex(c, true);
    }

    /* ---------- 2.4 许愿牌（姻缘牌）贴图：淡淡的文字纹理 ---------- */
    function buildTagTex() {
      const W = 256, H = 512;
      const c = cvs(W, H);
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, W, H);

      /* --- 上部：牌面 --- */
      ctx.fillStyle = '#a5161b';
      ctx.fillRect(0, 0, W, 340);
      // 纸/漆面纤维感
      for (let i = 0; i < 900; i++) {
        const x = rand(0, W), y = rand(0, 340);
        ctx.fillStyle = `rgba(${rand(150, 255) | 0},${rand(60, 120) | 0},${rand(50, 90) | 0},${rand(0.02, 0.07).toFixed(3)})`;
        ctx.fillRect(x, y, rand(1, 3), rand(4, 22));
      }
      const grad = ctx.createLinearGradient(0, 0, 0, 340);
      grad.addColorStop(0, 'rgba(255,190,140,0.10)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.14)');
      grad.addColorStop(1, 'rgba(255,170,120,0.06)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, 340);
      // 金色描边
      ctx.strokeStyle = 'rgba(230,196,116,0.50)';
      ctx.lineWidth = 6;
      ctx.strokeRect(11, 11, W - 22, 340 - 22);
      ctx.strokeStyle = 'rgba(230,196,116,0.22)';
      ctx.lineWidth = 2;
      ctx.strokeRect(24, 24, W - 48, 340 - 48);
      // 淡淡的竖向文字（姻缘天定）
      ctx.save();
      ctx.translate(W / 2, 54);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(244,214,140,0.52)';
      ctx.font = 'bold 46px "Songti SC","STSong","SimSun","Microsoft YaHei",serif';
      ['姻', '缘', '天', '定'].forEach((ch, i) => {
        ctx.save();
        ctx.filter = 'blur(0.3px)';
        ctx.fillText(ch, 0, i * 62);
        ctx.restore();
      });
      ctx.restore();
      // 下方小字（更低透明度，纯做“纹理”）
      ctx.save();
      ctx.translate(W / 2, 318);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(238,204,138,0.34)';
      ctx.font = '17px "Songti SC","STSong","SimSun","Microsoft YaHei",serif';
      ctx.fillText('有 情 人 终 成 眷 属', 0, 0);
      ctx.restore();
      // 一枚很淡的同心结纹样
      ctx.strokeStyle = 'rgba(238,206,140,0.24)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(W / 2, 300, 26, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(W / 2, 300, 12, 0, TAU);
      ctx.stroke();

      /* --- 中部：红绸（挂绳）--- */
      const silkGrad = ctx.createLinearGradient(0, 344, W, 424);
      silkGrad.addColorStop(0.0, '#8e0e14');
      silkGrad.addColorStop(0.5, '#e0252c');
      silkGrad.addColorStop(1.0, '#8e0e14');
      ctx.fillStyle = silkGrad;
      ctx.fillRect(0, 344, W, 80);
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(255,120,110,${rand(0.01, 0.05).toFixed(3)})`;
        ctx.fillRect(rand(0, W), 344, rand(1, 2), 80);
      }

      /* --- 下部：金色流苏 --- */
      const goldGrad = ctx.createLinearGradient(0, 428, 0, 508);
      goldGrad.addColorStop(0, '#c9a154');
      goldGrad.addColorStop(0.5, '#8a6a26');
      goldGrad.addColorStop(1, '#5a4415');
      ctx.fillStyle = goldGrad;
      ctx.fillRect(0, 428, W, 80);
      ctx.strokeStyle = 'rgba(20,12,4,0.30)';
      ctx.lineWidth = 2;
      for (let x = 3; x < W; x += 6) {
        ctx.beginPath();
        ctx.moveTo(x, 428);
        ctx.lineTo(x, 508);
        ctx.stroke();
      }

      return { texture: tex(c, true), W, H };
    }
    /** canvas 像素矩形 → UV 矩形（纹理默认 flipY） */
    function uvRect(x, y, w, h, W, H) {
      return { u0: x / W, v0: 1 - (y + h) / H, u1: (x + w) / W, v1: 1 - y / H };
    }
    function remapUV(geo, r, opt = {}) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        let u = uv.getX(i), v = uv.getY(i);
        if (opt.flipU) u = 1 - u;
        if (opt.flipV) v = 1 - v;
        uv.setXY(i, r.u0 + (r.u1 - r.u0) * u, r.v0 + (r.v1 - r.v0) * v);
      }
      uv.needsUpdate = true;
      return geo;
    }
    /** 盒体贴图：六个面都贴牌面，背面翻转 U 以免文字镜像 */
    function remapBoxUV(geo, r) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        const face = Math.floor(i / 4);
        let u = uv.getX(i), v = uv.getY(i);
        if (face === 5) u = 1 - u;
        uv.setXY(i, r.u0 + (r.u1 - r.u0) * u, r.v0 + (r.v1 - r.v0) * v);
      }
      uv.needsUpdate = true;
      return geo;
    }

    /* ---------- 2.5 格栅窗 ---------- */
    function buildLatticeTex() {
      const S = 256;
      const c = cvs(S, S);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0a0a08';
      ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = '#e79a44';
      ctx.lineWidth = 3;
      const cell = 32;
      for (let i = 0; i <= S; i += cell) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke();
      }
      ctx.strokeStyle = '#b5722c';
      ctx.lineWidth = 2;
      for (let i = 0; i < S; i += cell) {
        for (let j = 0; j < S; j += cell) {
          ctx.beginPath();
          ctx.moveTo(i + cell / 2, j + 5);
          ctx.lineTo(i + cell - 5, j + cell / 2);
          ctx.lineTo(i + cell / 2, j + cell - 5);
          ctx.lineTo(i + 5, j + cell / 2);
          ctx.closePath();
          ctx.stroke();
        }
      }
      return tex(c, true);
    }

    /* ---------- 2.6 柔光贴图（光晕 / 体积光） ---------- */
    function buildGlowTex(power = 2.2) {
      const S = 256;
      const c = cvs(S, S);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(S, S);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const dx = (x / S - 0.5) * 2, dy = (y / S - 0.5) * 2;
          const d = Math.min(1, Math.hypot(dx, dy));
          const a = Math.pow(1 - d, power);
          const i4 = (y * S + x) * 4;
          img.data[i4] = 255; img.data[i4 + 1] = 255; img.data[i4 + 2] = 255;
          img.data[i4 + 3] = clamp(a * 255, 0, 255);
        }
      }
      ctx.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }
    /** 体积光柱贴图：竖向渐隐 + 横向柔边 */
    function buildBeamTex() {
      const W = 128, H = 256;
      const c = cvs(W, H);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        const v = 1 - y / (H - 1);                        // 顶部亮
        const vfade = Math.pow(clamp(v, 0, 1), 1.5) * Math.pow(clamp((v - 0.02) / 0.5, 0, 1), 0.6);
        for (let x = 0; x < W; x++) {
          const u = (x / (W - 1)) * 2 - 1;
          const hfade = Math.pow(Math.max(0, 1 - Math.abs(u)), 0.85) * 0.75;
          const a = clamp(vfade * hfade, 0, 1);
          const i4 = (y * W + x) * 4;
          img.data[i4] = 255; img.data[i4 + 1] = 210; img.data[i4 + 2] = 150;
          img.data[i4 + 3] = a * 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    const BARK = buildBark();
    const STONE = buildStone();
    const PETAL_TEX = buildPetalTex();
    const TAG = buildTagTex();
    const LATTICE_TEX = buildLatticeTex();
    const GLOW_TEX = buildGlowTex(2.4);
    const BEAM_TEX = buildBeamTex();

    /* ==========================================================================
     * 3. 共享 Shader 注入：生长 / 风 / 悬挂物摆动
     *    全部在 GPU 上完成，CPU 每帧零开销
     * ======================================================================== */

    const uniforms = {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uWind: { value: 0 },
    };

    const GLSL_HEAD = /* glsl */`
    uniform float uTime;
    uniform float uProgress;
    uniform float uWind;
    uniform float uWindScale;
    attribute float aGrow;
    attribute float aSpan;
    attribute float aWind;
    float dshPhase(vec3 p){ return p.x * 0.35 + p.y * 0.12 + p.z * 0.28; }
    vec3 dshWindDisp(vec3 wp, float amt){
      float ph = dshPhase(wp);
      float t = uTime;
      float s = sin(t * 0.45 + ph) * 0.70 + sin(t * 0.86 + ph * 1.7) * 0.30;
      float c = cos(t * 0.39 + ph * 1.2) * 0.70 + cos(t * 0.72 + ph * 1.9) * 0.30;
      float a = uWind * uWindScale * amt;
      return vec3(s * a, sin(t * 0.63 + ph * 2.0) * a * 0.22, c * a);
    }
    vec3 dshRotX(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
    vec3 dshRotZ(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
    vec3 dshInstPos(){
      #ifdef USE_INSTANCING
        return (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #else
        return vec3(0.0);
      #endif
    }
    `;

    /**
     * 给材质注入 生长 / 风 / 摆动。
     * opt.grow : 'none' | 'collapse'(枝条从基部挤出) | 'scale'(挂件从悬点放大出现)
     * opt.wind : 是否随风位移
     * opt.windFrom : 'position' | 'instance'
     * opt.swing : 悬挂物钟摆幅度（弧度）
     * opt.ribbon: 绸带自身的柔性波动幅度
     */
    function inject(material, opt = {}) {
      const o = Object.assign(
        { grow: 'none', wind: false, windFrom: 'position', swing: 0, ribbon: 0, windScale: 1 },
        opt
      );
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uniforms.uTime;
        shader.uniforms.uProgress = uniforms.uProgress;
        shader.uniforms.uWind = uniforms.uWind;
        shader.uniforms.uWindScale = { value: o.windScale };

        let head = GLSL_HEAD;
        if (o.grow === 'collapse') head += 'attribute vec3 aOrigin;\n';
        if (o.swing > 0 || o.ribbon > 0) head += 'uniform float uSwing;\nuniform float uRibbonWave;\n';
        shader.vertexShader = head + shader.vertexShader;

        let begin = '#include <begin_vertex>\n';
        begin += `vec3 dshWP = ${o.windFrom === 'instance' ? 'dshInstPos()' : 'position'};\n`;
        begin += 'float dshSpan = max(aSpan, 0.0001);\n';
        begin += 'float dshG = smoothstep(aGrow, aGrow + dshSpan, uProgress);\n';
        if (o.grow === 'collapse') begin += 'transformed = mix(aOrigin, transformed, dshG);\n';
        else if (o.grow === 'scale') begin += 'transformed *= dshG;\n';

        if (o.swing > 0 || o.ribbon > 0) {
          begin += 'vec3 dshIP = dshInstPos();\nfloat dshPh = dshPhase(dshIP);\n';
          if (o.swing > 0) {
            begin += [
              'float dshA1 = (sin(uTime * 0.75 + dshPh) * 0.70 + sin(uTime * 1.55 + dshPh * 2.1) * 0.30) * uSwing;',
              'float dshA2 = (cos(uTime * 0.62 + dshPh * 1.4) * 0.70 + cos(uTime * 1.31 + dshPh * 2.4) * 0.30) * uSwing;',
              'transformed = dshRotZ(transformed, dshA1);',
              'transformed = dshRotX(transformed, dshA2);',
            ].join('\n') + '\n';
          }
          if (o.ribbon > 0) {
            begin += [
              'float dshHang = max(0.0, -transformed.y);',
              'transformed.x += sin(uTime * 1.15 + dshPh + dshHang * 1.9) * uRibbonWave * dshHang;',
              'transformed.z += cos(uTime * 0.95 + dshPh * 1.3 + dshHang * 1.5) * uRibbonWave * 0.85 * dshHang;',
            ].join('\n') + '\n';
          }
        }
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', begin);

        if (o.wind) {
          shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            [
              '#include <project_vertex>',
              '{',
              '  vec3 dshD = dshWindDisp(dshWP, aWind);',
              '  mvPosition.xyz += (viewMatrix * vec4(dshD, 0.0)).xyz;',
              '}',
            ].join('\n')
          );
        }
        shader.uniforms.uSwing = { value: o.swing };
        shader.uniforms.uRibbonWave = { value: o.ribbon };
      };
      material.customProgramCacheKey = () =>
        `dsh|${o.grow}|${o.wind ? 1 : 0}|${o.windFrom}|${o.swing}|${o.ribbon}|${o.windScale}`;
      return material;
    }

    /** 为几何体写入 aOrigin / aGrow / aSpan / aWind（静态量） */
    function tagGeo(geo, { grow = 0, span = 0.1, wind = 0, origin = null } = {}) {
      const n = geo.attributes.position.count;
      const og = new Float32Array(n * 3);
      if (origin) for (let i = 0; i < n; i++) { og[i * 3] = origin.x; og[i * 3 + 1] = origin.y; og[i * 3 + 2] = origin.z; }
      geo.setAttribute('aOrigin', new THREE.BufferAttribute(og, 3));
      geo.setAttribute('aGrow', new THREE.BufferAttribute(new Float32Array(n).fill(grow), 1));
      geo.setAttribute('aSpan', new THREE.BufferAttribute(new Float32Array(n).fill(span), 1));
      geo.setAttribute('aWind', new THREE.BufferAttribute(new Float32Array(n).fill(wind), 1));
      return geo;
    }
    function setVColor(geo, r, g, b) {
      const n = geo.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = r; arr[i * 3 + 1] = g; arr[i * 3 + 2] = b; }
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return geo;
    }

    /* ==========================================================================
     * 4. 分形老树
     * ======================================================================== */

    const ORDER_TIME = [               // [起始进度, 该层持续时间]（进度单位）
      [0.00, 0.14], [0.11, 0.19], [0.23, 0.19], [0.34, 0.19],
      [0.44, 0.19], [0.53, 0.18], [0.61, 0.17], [0.68, 0.15],
    ];
    const MAX_ORDER = CFG.maxOrder;
    // 逐层枝长与半径：主干短粗、一层主枝粗壮、逐层迅速变细变密（老树的层次感）
    const ORDER_LEN = [3.45, 3.05, 2.45, 1.90, 1.45, 1.10, 0.85, 0.62];
    const ORDER_RAD = [1.24, 0.86, 0.57, 0.375, 0.245, 0.152, 0.090, 0.052];
    // 每一层的花量权重：内侧枝条基本裸露（让遒劲骨架看得见），花云集中在外围
    const FLOWER_P = [0, 0, 0.18, 0.40, 0.66, 0.84, 0.93, 0.96];

    function windWeight(order, y) {
      const o = Math.min(order, MAX_ORDER) / MAX_ORDER;
      const h = clamp((y - 0.6) / 8.5, 0, 1);
      return clamp(Math.pow(o, 1.45) * 0.78 + h * 0.30, 0, 1.15);
    }

    function generateTree() {
      const segments = [];   // 枝条圆柱段
      const joints = [];     // 分叉处的球（藏住接缝）
      const tips = [];       // 枝梢（挂件/花团的锚点）
      const roots = [];

      const TRUNK_LEN = ORDER_LEN[0];
      const TRUNK_R = ORDER_RAD[0];

      function addSeg(a, b, ra, rb, order, grow, span, v0, v1, phaseSeed) {
        segments.push({ a, b, ra, rb, order, grow, span, v0, v1, wind: windWeight(order, (a.y + b.y) * 0.5), s: phaseSeed });
      }

      function growBranch(start, dir, length, radius, order, tStart, span, isStub) {
        const firstSegIdx = segments.length;
        const steps = isStub ? 3 : (order <= 2 ? 6 : (order <= 5 ? 5 : 4));
        const segLen = length / steps;
        // 残桩/枝茬不能去查 ORDER_RAD 表，否则会按表的比例“反向变粗”，长成一串棒槌
        const endRadius = isStub
          ? radius * 0.55
          : (order < MAX_ORDER ? ORDER_RAD[order + 1] * 0.97 : radius * 0.42);
        let p = start.clone();
        let d = dir.clone().normalize();
        const curveAmt = order === 0 ? rand(0.06, 0.15) : rand(0.08, 0.24);
        const curve = new THREE.Vector3(rand(-1, 1), rand(-1, 1) * 0.6, rand(-1, 1)).normalize().multiplyScalar(curveAmt);
        const jitter = order === 0 ? 0.034 : 0.070;
        // 锥度用几何插值：根部略胖、末端收得快，比线性更像真实老枝
        const taperK = Math.pow(endRadius / radius, 1);
        const radAt = (t) => radius * Math.pow(taperK, Math.pow(t, 0.88));
        let vAcc = rand(0, 3);

        for (let i = 0; i < steps; i++) {
          const t0 = i / steps, t1 = (i + 1) / steps;
          const a = p.clone();
          // 每年生长留下的“肘部”：偶发一次较大的转向，枝条才有遒劲的折感
          if (i > 0 && rnd() < 0.22) {
            const kAxis = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).cross(d);
            if (kAxis.lengthSq() < 1e-4) kAxis.set(1, 0, 0);
            kAxis.normalize();
            d.applyAxisAngle(kAxis, rand(0.10, 0.32) * (rnd() < 0.5 ? -1 : 1));
          }
          d.addScaledVector(curve, 1 / steps)
            .add(new THREE.Vector3(
              rand(-jitter, jitter),
              rand(-jitter, jitter) + (order === 0 ? -0.004 : (order >= 3 ? 0.028 : -0.016)),
              rand(-jitter, jitter)))
            .normalize();
          const b = a.clone().addScaledVector(d, segLen);
          const ra = radAt(t0);
          const rb = radAt(t1);
          const v0 = vAcc;
          vAcc += segLen / 1.8;
          addSeg(a, b, ra, rb, order, tStart + span * t0, (span / steps) * 1.8, v0, vAcc, i);
          p = b;
        }

        const endT = tStart + span;
        const tipPos = p.clone();
        const tipRadius = endRadius;      // 本枝末端半径（分叉球用它兜住接缝）

        const capReached = segments.length > 6200;   // 段数保险丝，避免性能失控
        if (!isStub && !capReached && order < MAX_ORDER && radius > 0.030) {
          // 层次：主枝分叉多而粗，细枝基本二叉 → 越往外越密
          const n = order === 0 ? 5
            : (order === 1 ? (rnd() < 0.70 ? 3 : 2)
              : (order >= 6 ? (rnd() < 0.20 ? 3 : 2) : (rnd() < 0.34 ? 3 : 2)));
          const baseAxis = new THREE.Vector3(1, 0, 0).cross(d);
          if (baseAxis.lengthSq() < 0.01) baseAxis.set(0, 0, 1);
          baseAxis.normalize();

          for (let k = 0; k < n; k++) {
            // 最外层再抽掉一部分，避免细枝爆炸式增长
            if (order === MAX_ORDER - 1 && rnd() < 0.38) continue;
            let axis;
            if (order === 0) {
              axis = baseAxis.clone().applyAxisAngle(d, (k / n) * TAU + rand(-0.30, 0.30));
            } else {
              axis = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).cross(d);
              if (axis.lengthSq() < 1e-4) axis.copy(baseAxis);
              axis.normalize();
            }
            // 主干的第一根分枝几乎直立 → 树冠中间不空
            const spread = order === 0
              ? (k === 0 ? rand(0.16, 0.38) : rand(0.58, 0.88))
              : rand(0.30, 0.70) * (rnd() < 0.20 ? 1.5 : 1.0);
            const cdir = d.clone().applyAxisAngle(axis, spread).normalize();
            // 主枝先向外压、细枝再上扬：形成“伞骨下垂再翘起”的老树冠形
            cdir.y += order === 0 ? 0.06 : (order === 1 ? -0.03 : (order === 2 ? 0.05 : 0.14));
            cdir.normalize();

            const clen = ORDER_LEN[order + 1] * rand(0.86, 1.16);
            const crad = ORDER_RAD[order + 1] * rand(0.92, 1.06);
            const cStart = Math.max(ORDER_TIME[order + 1][0], endT - 0.02) + rand(0, 0.030);
            const cSpan = ORDER_TIME[order + 1][1] * rand(0.86, 1.14);

            joints.push({
              pos: tipPos.clone(),
              radius: Math.max(tipRadius * 1.02, crad * 1.30),
              order,
              grow: cStart,
              wind: windWeight(order, tipPos.y),
            });

            growBranch(tipPos.clone().addScaledVector(cdir, -Math.min(0.07, clen * 0.06)), cdir, clen, crad, order + 1, cStart, cSpan, false);
          }
        } else {
          // 到梢了：只给“最后一段”打末梢标记，几何阶段会把它收成细尖；
          // 若整枝都打标，就会一根枝上套一串锥帽，变成层层切口的竹节。
          if (segments.length > firstSegIdx) segments[segments.length - 1].tip = true;
          if (isStub) for (let k = firstSegIdx; k < segments.length; k++) segments[k].stub = true;
          tips.push({
            pos: tipPos, dir: d.clone(), radius, order,
            grow: endT, wind: windWeight(order, tipPos.y),
          });
        }
      }

      // 主干（略微倾斜，避免笔直得像电线杆）
      growBranch(new THREE.Vector3(0, -0.25, 0), new THREE.Vector3(0.07, 1, 0.045), TRUNK_LEN, TRUNK_R, 0, ORDER_TIME[0][0], ORDER_TIME[0][1], false);

      // 结疤：只留几颗“埋在树皮里的疙瘩”，大半沉进主干，避免看起来像堆石头
      for (let i = 0; i < 5; i++) {
        const t = rand(0.15, 0.80);
        const ang = rand(0, TAU);
        const y = lerp(0.2, TRUNK_LEN * 0.9, t);
        const rr = lerp(TRUNK_R, ORDER_RAD[1] * 0.97, t) * (1 + 0.40 * Math.exp(-Math.max(0, y) / 0.85));
        joints.push({
          pos: new THREE.Vector3(Math.cos(ang) * rr * 0.72, y, Math.sin(ang) * rr * 0.72),
          radius: rand(0.07, 0.13) * (1 - 0.35 * t),
          order: 0,
          grow: clamp(0.03 + t * 0.14 + rand(0, 0.05), 0, 1),
          wind: windWeight(0, y),
        });
      }

      // 断枝残桩：老树上被折断的枝茬，最能体现“遒劲”
      for (let i = 0; i < 11; i++) {
        const t = rand(0.05, 0.80);
        const ang = rand(0, TAU);
        const y = lerp(0.15, TRUNK_LEN * 1.02, t);
        const rr = lerp(TRUNK_R, ORDER_RAD[1] * 0.97, t) * (1 + 0.40 * Math.exp(-Math.max(0, y) / 0.85));
        const pos = new THREE.Vector3(Math.cos(ang) * rr * 0.92, y, Math.sin(ang) * rr * 0.92);
        const dir = new THREE.Vector3(Math.cos(ang), rand(0.25, 0.95), Math.sin(ang)).normalize();
        growBranch(pos, dir, rand(0.30, 0.85), rand(0.10, 0.055 + 0.16 * (1 - t)), 1, rand(0.03, 0.13), 0.10, true);
      }

      // 板根：细而长、贴地铺开（太粗太短就会变成一堆石头）
      const rootN = 9;
      for (let i = 0; i < rootN; i++) {
        const ang = (i / rootN) * TAU + rand(-0.22, 0.22);
        const dir = new THREE.Vector3(Math.cos(ang), rand(-0.50, -0.30), Math.sin(ang)).normalize();
        const start = new THREE.Vector3(Math.cos(ang) * 0.32, rand(0.34, 0.72), Math.sin(ang) * 0.32);
        const len = rand(2.40, 3.60);
        const steps = 6;
        const r0 = rand(0.105, 0.165), r1 = 0.018;
        let p = start.clone();
        let vAcc = rand(0, 3);
        const d0 = dir.clone();
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps, t1 = (s + 1) / steps;
          const a = p.clone();
          d0.y -= 0.20;
          d0.normalize();
          const b = a.clone().addScaledVector(d0, len / steps);
          // 贴地：不让根部穿到地下太深
          b.y = Math.max(b.y, 0.015 + rand(0, 0.03));
          const v0 = vAcc; vAcc += (len / steps) / 1.8;
          addSeg(a, b, lerp(r0, r1, t0), lerp(r0, r1, t1), 0, rand(0.03, 0.10), 0.14, v0, vAcc, s);
          const seg = segments[segments.length - 1];
          seg.root = true;
          seg.wind = 0.02;          // 根不动
          roots.push(b.clone());
          p = b;
        }
      }

      return { segments, joints, tips, roots };
    }

    /** 树皮凹凸：环向整数周期噪声 + 高度噪声，做出瘤状起伏与纵向棱（无缝、不镜像） */
    function barkOffset(ang, y, along, radius, order) {
      if (order === 0) {
        // 频率必须低于环向采样率，否则混叠成石块；同时幅度只能占半径的两成左右，
        // 大起伏靠低频、细纹理交给法线贴图，才不会长成一坨疙瘩。
        const a = (ang / TAU) * 3;
        const n1 = fbm(a, y * 0.45, 2, 5) - 0.5;                    // 低频大形
        const wob = fbm(a, y * 0.35, 2, 17) * 2.5;
        const ridge = Math.sin(ang * 3 + wob);                      // 3 条纵向棱
        const n2 = fbm(a * 1.5, y * 0.85, 2, 9) - 0.5;              // 中等块面
        return (n1 * 0.42 + ridge * 0.10 + n2 * 0.14) * radius;
      }
      // 横枝必须用“沿枝长”的坐标：沿用世界 y 的话整根枝截面不变，看起来就是一块板条
      const a = (ang / TAU) * 5;
      const n = fbm(a * 0.9 + order * 3.0, along * 1.6, 2, 11) - 0.5;
      return n * radius * 0.85;
    }

    function buildTreeMesh(data) {
      const P = [], N = [], UV = [], O = [], G = [], SP = [], W = [];
      const up = new THREE.Vector3();
      const u = new THREE.Vector3(), v = new THREE.Vector3(), axis = new THREE.Vector3();
      const c = new THREE.Vector3();

      function vert(px, py, pz, nx, ny, nz, tu, tv, ox, oy, oz, g, sp, w) {
        P.push(px, py, pz); N.push(nx, ny, nz); UV.push(tu, tv);
        O.push(ox, oy, oz); G.push(g); SP.push(sp); W.push(w);
      }

      for (const s of data.segments) {
        axis.subVectors(s.b, s.a);
        const len = axis.length();
        if (len < 1e-5) continue;
        axis.divideScalar(len);
        up.set(0, 1, 0);
        if (Math.abs(axis.y) > 0.94) up.set(1, 0, 0);
        u.crossVectors(up, axis).normalize();
        v.crossVectors(axis, u).normalize();

        // 细枝给足截面：6 边形近看就是“板条”
        const radial = s.stub ? 7
          : (s.root ? 10
            : (s.order === 0 ? 22
              : (s.order === 1 ? 12
                : (s.order === 2 ? 10 : (s.order <= 4 ? 8 : 7)))));
        const rMid = (s.ra + s.rb) * 0.5;
        const uRep = clamp((TAU * rMid) / 1.8, 1, 5);
        // 置换幅度按“相对于自身半径”给，细枝不再被噪声顶成锯齿板条
        const dispAmt = s.stub ? 0.30
          : (s.root ? 0.22
            : (s.order === 0 ? 0.55 : (s.order === 1 ? 0.30 : (s.order === 2 ? 0.20 : 0.12))));

        const ring = [];
        for (let k = 0; k <= radial; k++) {
          const ang = (k / radial) * TAU;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          ring.push({
            ca, sa,
            du: u.x * ca + v.x * sa,
            dv: u.y * ca + v.y * sa,
            dw: u.z * ca + v.z * sa,
          });
        }
        // 每圈顶点；axial 会把法线沿轴倾斜，收尖的锥面才不会用圆柱的方式受光
        const makeRingVert = (center, rad, y, t, axial = 0) => {
          const out = [];
          for (let k = 0; k <= radial; k++) {
            const r = ring[k];
            // 板根外扩：靠近地面的主干变粗
            let rMul = 1;
            if (s.order === 0 && !s.stub && !s.root) rMul *= 1 + 0.40 * Math.exp(-Math.max(0, y) / (0.85 * treeData.scale));
            const off = barkOffset(Math.atan2(r.sa, r.ca), y, t, rad, s.order) * dispAmt;
            const rr = rad * rMul + off;
            const px = center.x + r.du * rr, py = center.y + r.dv * rr, pz = center.z + r.dw * rr;
            let nx = r.du + axis.x * axial, ny = r.dv + axis.y * axial, nz = r.dw + axis.z * axial;
            const nl = Math.hypot(nx, ny, nz) || 1;
            out.push([px, py, pz, nx / nl, ny / nl, nz / nl, (k / radial) * uRep, t]);
          }
          return out;
        };
        const A = makeRingVert(s.a, s.ra, s.a.y, s.v0);
        const B = makeRingVert(s.b, s.rb, s.b.y, s.v1);
        const o = s.a;   // 生长塌缩原点 = 该段基部

        const quad = (r0, r1, v0t, v1t) => {
          for (let k = 0; k < radial; k++) {
            const a0 = r0[k], a1 = r0[k + 1], b1 = r1[k + 1], b0 = r1[k];
            vert(...a0, o.x, o.y, o.z, s.grow, s.span, s.wind);
            vert(...a1, o.x, o.y, o.z, s.grow, s.span, s.wind);
            vert(...b1, o.x, o.y, o.z, s.grow, s.span, s.wind);
            vert(...a0, o.x, o.y, o.z, s.grow, s.span, s.wind);
            vert(...b1, o.x, o.y, o.z, s.grow, s.span, s.wind);
            vert(...b0, o.x, o.y, o.z, s.grow, s.span, s.wind);
          }
          void v0t; void v1t;
        };
        quad(A, B);

        // 枝梢：沿轴向收成一枚细长尖（长度约 5.2 倍末端半径），
        // 断枝残桩则收成钝头 —— 老树的枝茬本来就是断的。
        // 数值是 [半径系数, 沿轴距离(以末端半径为单位)]，法线按锥面斜率倾斜。
        if (s.tip) {
          const capDef = s.stub
            ? [[0.72, 0.26], [0.40, 0.62], [0.0, 0.92]]
            : [[0.66, 1.15], [0.34, 2.75], [0.0, 5.20]];
          let prev = B;
          for (const [cr, ct] of capDef) {
            const center = new THREE.Vector3(s.b.x + axis.x * s.rb * ct,
                                             s.b.y + axis.y * s.rb * ct,
                                             s.b.z + axis.z * s.rb * ct);
            const cur = makeRingVert(center, s.rb * cr, center.y, s.v1, 0.26);
            quad(prev, cur);
            prev = cur;
          }
        }
      }

      // 分叉球
      for (const j of data.joints) {
        const geo = new THREE.SphereGeometry(j.radius, 8, 6);
        geo.translate(j.pos.x, j.pos.y, j.pos.z);
        tagGeo(geo, { grow: j.grow, span: 0.06, wind: j.wind, origin: j.pos });
        const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, uv = geo.attributes.uv.array;
        const cnt = geo.attributes.position.count;
        for (let i = 0; i < cnt; i++) {
          P.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
          N.push(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
          UV.push(uv[i * 2] * 1.5, uv[i * 2 + 1] * 1.5);
          O.push(j.pos.x, j.pos.y, j.pos.z);
          G.push(j.grow); SP.push(0.06); W.push(j.wind);
        }
        geo.dispose();
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      geo.setAttribute('aOrigin', new THREE.Float32BufferAttribute(O, 3));
      geo.setAttribute('aGrow', new THREE.Float32BufferAttribute(G, 1));
      geo.setAttribute('aSpan', new THREE.Float32BufferAttribute(SP, 1));
      geo.setAttribute('aWind', new THREE.Float32BufferAttribute(W, 1));
      geo.computeBoundingSphere();
      return geo;
    }

    /* ==========================================================================
     * 5. 场景搭建
     * ======================================================================== */

    const treeData = generateTree();

    /* 把树归一化到目标高度：无论随机种子如何，构图比例都与参考图一致 */
    (function normalizeTree(data) {
      let maxY = -Infinity, minY = Infinity, maxR = 0;
      for (const s of data.segments) {
        maxY = Math.max(maxY, s.a.y, s.b.y);
        minY = Math.min(minY, s.a.y, s.b.y);
        maxR = Math.max(maxR, Math.hypot(s.b.x, s.b.z));
      }
      const rawH = Math.max(0.001, maxY - Math.min(minY, -0.25));
      const k = 9.9 / rawH;
      data.scale = k;
      data.height = maxY * k;
      data.spread = maxR * k;
      for (const s of data.segments) {
        s.a.multiplyScalar(k); s.b.multiplyScalar(k);
        s.ra *= k; s.rb *= k;
      }
      for (const j of data.joints) { j.pos.multiplyScalar(k); j.radius *= k; }
      for (const t of data.tips) { t.pos.multiplyScalar(k); t.radius *= k; }
    })(treeData);

    /* ---------- 5.1 树干材质 ---------- */
    const barkMat = new THREE.MeshStandardMaterial({
      map: BARK.map,
      normalMap: BARK.normal,
      normalScale: new THREE.Vector2(1.30, 1.30),
      roughnessMap: BARK.rough,
      roughness: 1.0,
      metalness: 0.0,
      color: 0xbdb2a4,
      emissive: 0x1e1309,
      emissiveIntensity: 1.0,
      envMapIntensity: 0.35,
    });
    inject(barkMat, { grow: 'collapse', wind: true, windFrom: 'position', windScale: 1.0 });

    const treeMesh = new THREE.Mesh(buildTreeMesh(treeData), barkMat);
    treeMesh.castShadow = true;
    treeMesh.receiveShadow = true;
    treeMesh.frustumCulled = false;
    treeMesh.visible = false;
    scene.add(treeMesh);

    /* 阴影用的深度材质也要跟着生长，否则影子会过早出现 */
    const treeDepthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    inject(treeDepthMat, { grow: 'collapse', wind: false });
    treeMesh.customDepthMaterial = treeDepthMat;

    /* 依据树的真实包围盒自动取景，保证“树占画面约 85%”的构图 */
    (function fitCameraToTree() {
      const bb = new THREE.Box3().setFromObject(treeMesh);
      const size = bb.getSize(new THREE.Vector3());
      const center = bb.getCenter(new THREE.Vector3());
      const half = THREE.MathUtils.degToRad(camera.fov) / 2;
      const dv = (size.y * 0.560) / Math.tan(half);
      const dh = (Math.max(size.x, size.z) * 0.470) / (Math.tan(half) * camera.aspect);
      const dist = Math.max(dv, dh) * 1.04;
      const dir = new THREE.Vector3(0.10, 0.175, 1).normalize();
      CAM_B.tgt.copy(center).add(new THREE.Vector3(0, -0.75, 0));
      CAM_B.pos.copy(CAM_B.tgt).addScaledVector(dir, dist);
      controls.maxDistance = Math.max(16, dist * 1.55);
      treeData.fit = { size, center, dist };
    })();

    /* ---------- 5.2 花团 ---------- */
    function buildBlossomGeo() {
      const parts = [];
      for (let i = 0; i < 1; i++) {
        const g = new THREE.IcosahedronGeometry(rand(0.080, 0.104), 0);
        const pos = g.attributes.position;
        for (let k = 0; k < pos.count; k++) {
          pos.setXYZ(k,
            pos.getX(k) * rand(0.88, 1.12),
            pos.getY(k) * rand(0.80, 1.08),
            pos.getZ(k) * rand(0.88, 1.12));
        }
        g.translate(rand(-0.05, 0.05), rand(-0.04, 0.05), rand(-0.05, 0.05));
        parts.push(g);
      }
      return mergeGeometries(parts, false);
    }

    const blossomMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.70,
      metalness: 0.0,
      emissive: 0x360606,
      emissiveIntensity: 1.0,
      flatShading: false,
      envMapIntensity: 0.30,
    });
    inject(blossomMat, { grow: 'scale', wind: true, windFrom: 'instance', windScale: 1.0 });

    function buildFlowers(data) {
      const items = [];
      for (const s of data.segments) {
        if (s.order < 2) continue;
        const p = FLOWER_P[Math.min(s.order, FLOWER_P.length - 1)];
        if (rnd() > p) continue;
        const n = s.order >= 6 ? randInt(3, 5) : randInt(4, 8);
        const dir = new THREE.Vector3().subVectors(s.b, s.a).normalize();
        const grow = Math.min(1, s.grow + s.span + rand(0.0, 0.12));
        for (let k = 0; k < n; k++) {
          const t = rand(0.05, 1.0);
          const base = new THREE.Vector3().lerpVectors(s.a, s.b, t);
          const perp = new THREE.Vector3(rand(-1, 1), rand(-1, 1) * 0.7, rand(-1, 1));
          perp.addScaledVector(dir, -perp.dot(dir));
          if (perp.lengthSq() < 1e-5) perp.set(0, 1, 0);
          const spread = s.order >= 4 ? rand(0.26, 1.15) : rand(0.16, 0.66);
          perp.normalize().multiplyScalar(Math.pow(rnd(), 0.7) * spread);
          const pos = base.clone().add(perp);
          pos.y += rand(-0.06, 0.34);
          items.push({
            pos,
            scl: rand(1.55, 3.00) * data.scale,
            grow: clamp(grow + rand(0, 0.05), 0, 1),
            wind: s.wind,
            hue: rand(-0.012, 0.030),
            lum: rand(0.21, 0.35),
          });
        }
      }
      const mesh = new THREE.InstancedMesh(buildBlossomGeo(), blossomMat, items.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      const g = new Float32Array(items.length), sp = new Float32Array(items.length), w = new Float32Array(items.length);
      const col = new THREE.Color();
      items.forEach((it, i) => {
        q.setFromEuler(new THREE.Euler(rand(0, TAU), rand(0, TAU), rand(0, TAU)));
        sc.setScalar(it.scl);
        m.compose(it.pos, q, sc);
        mesh.setMatrixAt(i, m);
        col.setHSL(0.995 + it.hue, rand(0.88, 1.0), it.lum);
        mesh.setColorAt(i, col);
        g[i] = it.grow; sp[i] = 0.075; w[i] = it.wind;
      });
      mesh.geometry.setAttribute('aGrow', new THREE.InstancedBufferAttribute(g, 1));
      mesh.geometry.setAttribute('aSpan', new THREE.InstancedBufferAttribute(sp, 1));
      mesh.geometry.setAttribute('aWind', new THREE.InstancedBufferAttribute(w, 1));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.frustumCulled = false;
      return mesh;
    }

    const flowers = buildFlowers(treeData);
    scene.add(flowers);

    /* ---------- 5.3 挂件几何 ---------- */

    /** 红绸带：带弧面与扭转的绸布（横向多列顶点，让光照有柔软的渐变） */
    function buildRibbonGeo() {
      const N = 22, H = rand(2.35, 2.95);
      const cols = [-1, -0.5, 0, 0.5, 1];
      const P = [], Nn = [], UV = [], idx = [];
      const twist = rand(-1.1, 1.1);
      const taper = rand(0.30, 0.58);
      const wide = rand(0.056, 0.072);
      for (let j = 0; j <= N; j++) {
        const t = j / N;
        const y = -H * t;
        const w = wide * (1 - taper * t);
        const cx = Math.sin(t * 2.1 + twist) * 0.15 * t;
        const cz = Math.cos(t * 2.6 + twist) * 0.065 * t;
        const tang = new THREE.Vector3(Math.cos(t * 2.1 + twist) * 0.30, -1, -Math.sin(t * 2.6 + twist) * 0.17).normalize();
        const across = new THREE.Vector3(1, 0, 0);
        const nrm = new THREE.Vector3().crossVectors(across, tang).normalize();
        for (const c of cols) {
          const bow = (1 - c * c) * 0.020 * (1 - t);        // 布的弧面
          const nx = nrm.x + across.x * c * 0.55;
          const ny = nrm.y + across.y * c * 0.55;
          const nz = nrm.z + across.z * c * 0.55;
          const nl = Math.hypot(nx, ny, nz) || 1;
          P.push(cx + across.x * c * w + nrm.x * bow,
                 y + across.y * c * w + nrm.y * bow,
                 cz + across.z * c * w + nrm.z * bow);
          Nn.push(nx / nl, ny / nl, nz / nl);
          UV.push((c + 1) / 2, t * 7);
        }
      }
      for (let j = 0; j < N; j++) {
        for (let k = 0; k < cols.length - 1; k++) {
          const a = j * cols.length + k;
          const b = a + 1;
          const c2 = (j + 1) * cols.length + k + 1;
          const d = (j + 1) * cols.length + k;
          idx.push(a, b, c2, a, c2, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      geo.setIndex(idx);
      const uvA = geo.attributes.uv;   // 卷到红绸区域
      const r = uvRect(0, 344, 256, 80, TAG.W, TAG.H);
      for (let i = 0; i < uvA.count; i++) uvA.setXY(i, r.u0 + (r.u1 - r.u0) * uvA.getX(i), r.v0 + (r.v1 - r.v0) * (uvA.getY(i) % 1));
      return geo;
    }

    /** 许愿姻缘牌：挂绳 + 牌面（带文字）+ 结 + 流苏 */
    function buildTagGeo() {
      const R_FACE = uvRect(0, 0, 256, 340, TAG.W, TAG.H);
      const R_SILK = uvRect(0, 344, 256, 80, TAG.W, TAG.H);
      const R_GOLD = uvRect(0, 428, 256, 80, TAG.W, TAG.H);
      const parts = [];

      const plate = new THREE.BoxGeometry(0.235, 0.335, 0.026);
      remapBoxUV(plate, R_FACE);
      plate.translate(0, -0.455, 0);
      parts.push(plate);

      const rope = new THREE.CylinderGeometry(0.0055, 0.0055, 0.30, 5);
      remapUV(rope, R_SILK);
      rope.translate(0, -0.15, 0);
      parts.push(rope);

      const knot = new THREE.SphereGeometry(0.021, 8, 6);
      remapUV(knot, R_SILK);
      knot.translate(0, -0.30, 0);
      parts.push(knot);

      const tassel = new THREE.CylinderGeometry(0.030, 0.012, 0.17, 6);
      remapUV(tassel, R_GOLD);
      tassel.translate(0, -0.715, 0);
      parts.push(tassel);

      return mergeGeometries(parts, false);
    }

    /** 黄铜同心锁 */
    function buildLockGeo() {
      const parts = [];
      const rope = new THREE.CylinderGeometry(0.0045, 0.0045, 0.22, 5);
      rope.translate(0, -0.11, 0);
      setVColor(rope, 0.35, 0.05, 0.05);
      parts.push(rope);

      const shackle = new THREE.TorusGeometry(0.072, 0.016, 6, 14, Math.PI);
      shackle.rotateZ(0);
      shackle.translate(0, -0.235, 0);
      setVColor(shackle, 0.60, 0.46, 0.19);
      parts.push(shackle);

      const body = new THREE.SphereGeometry(0.105, 12, 9);
      body.scale(1.0, 1.18, 0.34);
      body.translate(0, -0.365, 0);
      setVColor(body, 0.86, 0.68, 0.30);
      parts.push(body);

      const hole = new THREE.CylinderGeometry(0.016, 0.016, 0.02, 8);
      hole.rotateX(Math.PI / 2);
      hole.translate(0, -0.375, 0.036);
      setVColor(hole, 0.10, 0.08, 0.06);
      parts.push(hole);

      const geo = mergeGeometries(parts, false);
      return geo;
    }

    /** 小红福袋 */
    function buildPouchGeo() {
      const parts = [];
      const rope = new THREE.CylinderGeometry(0.0045, 0.0045, 0.17, 5);
      rope.translate(0, -0.085, 0);
      setVColor(rope, 0.45, 0.06, 0.06);
      parts.push(rope);

      const bag = new THREE.SphereGeometry(0.125, 12, 10);
      bag.scale(1.0, 1.12, 0.88);
      bag.translate(0, -0.30, 0);
      setVColor(bag, 0.62, 0.055, 0.055);
      parts.push(bag);

      const band = new THREE.TorusGeometry(0.058, 0.017, 6, 14);
      band.rotateX(Math.PI / 2);
      band.translate(0, -0.19, 0);
      setVColor(band, 0.80, 0.62, 0.24);
      parts.push(band);

      const tassel = new THREE.CylinderGeometry(0.026, 0.009, 0.15, 6);
      tassel.translate(0, -0.53, 0);
      setVColor(tassel, 0.78, 0.60, 0.24);
      parts.push(tassel);
      return mergeGeometries(parts, false);
    }

    /** 迷你中式纸灯笼 */
    function buildLanternGeo() {
      const parts = [];
      const rope = new THREE.CylinderGeometry(0.005, 0.005, 0.36, 5);
      rope.translate(0, -0.18, 0);
      parts.push(rope);

      const top = new THREE.CylinderGeometry(0.072, 0.082, 0.05, 10);
      top.translate(0, -0.375, 0);
      parts.push(top);

      const body = new THREE.SphereGeometry(0.185, 14, 10);
      body.scale(1.0, 0.84, 1.0);
      body.translate(0, -0.53, 0);
      parts.push(body);

      const bot = new THREE.CylinderGeometry(0.072, 0.062, 0.045, 10);
      bot.translate(0, -0.685, 0);
      parts.push(bot);

      const tassel = new THREE.CylinderGeometry(0.018, 0.008, 0.16, 6);
      tassel.translate(0, -0.79, 0);
      parts.push(tassel);

      const geo = mergeGeometries(parts, false);
      // 竖骨
      return geo;
    }

    /* ---------- 5.4 材质 ---------- */
    const silkMat = inject(new THREE.MeshStandardMaterial({
      map: TAG.texture, color: 0xffffff, roughness: 0.5, metalness: 0.0,
      side: THREE.DoubleSide, emissive: 0x2a0404, emissiveIntensity: 1.0,
      envMapIntensity: 0.35,
    }), { grow: 'scale', wind: true, windFrom: 'instance', swing: 0.075, ribbon: 0.030, windScale: 1.05 });

    const tagMat = inject(new THREE.MeshStandardMaterial({
      map: TAG.texture, roughness: 0.60, metalness: 0.0,
      side: THREE.DoubleSide, emissive: 0x230303, emissiveIntensity: 1.0,
      envMapIntensity: 0.30,
    }), { grow: 'scale', wind: true, windFrom: 'instance', swing: 0.062, ribbon: 0.008, windScale: 1.0 });

    const lockMat = inject(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.34, metalness: 0.88,
      emissive: 0x140a02, emissiveIntensity: 1.0, envMapIntensity: 1.15,
    }), { grow: 'scale', wind: true, windFrom: 'instance', swing: 0.068, ribbon: 0.0, windScale: 1.0 });

    const pouchMat = inject(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.62, metalness: 0.12,
      emissive: 0x200202, emissiveIntensity: 1.0, envMapIntensity: 0.45,
    }), { grow: 'scale', wind: true, windFrom: 'instance', swing: 0.072, ribbon: 0.014, windScale: 1.05 });

    const lanternItemMat = inject(new THREE.MeshStandardMaterial({
      color: 0x180a04, emissive: 0xff7c1e, emissiveIntensity: 1.02,
      roughness: 0.6, metalness: 0.0, envMapIntensity: 0.3,
    }), { grow: 'scale', wind: true, windFrom: 'instance', swing: 0.085, ribbon: 0.006, windScale: 1.1 });

    /* ---------- 5.5 随机悬挂 ---------- */
    function buildHangings(data) {
      const anchors = [];
      let total = 0;
      for (const s of data.segments) {
        if (s.order < 2) continue;
        const w = Math.pow(s.order - 1, 1.5) * (s.a.y > 1.2 ? 1 : 0.25);
        total += w;
        anchors.push({ s, acc: total });
      }
      function pickAnchor() {
        const r = rnd() * total;
        let lo = 0, hi = anchors.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (anchors[mid].acc < r) lo = mid + 1; else hi = mid;
        }
        return anchors[lo].s;
      }

      const types = [
        { kind: 'ribbon', geo: buildRibbonGeo, mat: silkMat, n: 68, minY: 2.1 },
        { kind: 'tag', geo: buildTagGeo, mat: tagMat, n: 58, minY: 1.9 },
        { kind: 'lock', geo: buildLockGeo, mat: lockMat, n: 44, minY: 1.5 },
        { kind: 'pouch', geo: buildPouchGeo, mat: pouchMat, n: 42, minY: 1.5 },
        { kind: 'lantern', geo: buildLanternGeo, mat: lanternItemMat, n: 26, minY: 1.6 },
      ];

      const meshes = [];
      const lanternSpots = [];
      const IS = data.scale;         // 挂件尺寸跟着树的归一化比例走
      const RIB_LEN = 2.25 * IS;

      for (const t of types) {
        const items = [];
        let guard = 0;
        while (items.length < t.n && guard++ < t.n * 40) {
          const s = pickAnchor();
          const f = rand(0.12, 0.98);
          const pos = new THREE.Vector3().lerpVectors(s.a, s.b, f);
          if (pos.y < t.minY * IS) continue;
          const rad = lerp(s.ra, s.rb, f);
          pos.y -= rad * 0.9 + 0.03 * IS;
          pos.x += rand(-0.10, 0.10) * IS;
          pos.z += rand(-0.10, 0.10) * IS;
          let sc = rand(0.82, 1.22) * IS;
          // 绸带不能插进地面
          if (t.kind === 'ribbon') {
            const maxS = Math.max(0.30, (pos.y - 0.18 * IS) / RIB_LEN);
            const scl = new THREE.Vector3(sc, Math.min(sc, maxS) * rand(0.80, 1.05), sc);
            items.push({ pos, rot: new THREE.Euler(rand(-0.10, 0.10), rand(0, TAU), rand(-0.10, 0.10)), scl, wind: s.wind });
          } else {
            sc *= rand(0.9, 1.1);
            items.push({ pos, rot: new THREE.Euler(rand(-0.12, 0.12), rand(0, TAU), rand(-0.12, 0.12)), scl: new THREE.Vector3(sc, sc, sc), wind: s.wind });
          }
          if (t.kind === 'lantern') lanternSpots.push(pos.clone());
        }

        const geo = t.geo();
        const mesh = new THREE.InstancedMesh(geo, t.mat, items.length);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion();
        const g = new Float32Array(items.length), sp = new Float32Array(items.length), w = new Float32Array(items.length);
        items.forEach((it, i) => {
          q.setFromEuler(it.rot);
          m.compose(it.pos, q, it.scl);
          mesh.setMatrixAt(i, m);
          g[i] = clamp(0.845 + rnd() * 0.12, 0, 1);
          sp[i] = 0.045;
          w[i] = it.wind;
        });
        geo.setAttribute('aGrow', new THREE.InstancedBufferAttribute(g, 1));
        geo.setAttribute('aSpan', new THREE.InstancedBufferAttribute(sp, 1));
        geo.setAttribute('aWind', new THREE.InstancedBufferAttribute(w, 1));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        meshes.push(mesh);
      }

      return { meshes, lanternSpots };
    }

    const hangings = buildHangings(treeData);
    hangings.meshes.forEach((m) => scene.add(m));

    /* ---------- 5.6 缠绕树干的红绸 ---------- */
    function buildTrunkWraps() {
      const parts = [];
      const N_WRAP = 5;
      const S = treeData.scale;
      const R0 = ORDER_RAD[0] * S;                 // 归一化后的主干半径
      const flare = (y) => 1 + 0.40 * Math.exp(-Math.max(0, y) / (0.85 * S));
      const trunkR = (ang, y) => R0 * flare(y) * (1 + (fbm(Math.cos(ang) * 1.8, y * 0.55 / S, 3, 5) - 0.5) * 0.9 * 0.30);

      for (let k = 0; k < N_WRAP; k++) {
        const y0 = rand(0.5, 2.9) * S;
        const a0 = rand(0, TAU);
        const dirSign = rnd() < 0.5 ? 1 : -1;
        const turns = rand(0.35, 0.72) * dirSign;
        const steps = 30;
        const width = rand(0.055, 0.085) * S;
        const dy = rand(0.5, 1.5) * S;             // 一圈里向上爬升的高度（循环外取一次！）
        const sag = rand(0.9, 1.7);                // 收尾垂下来的绸尾

        const pts = [];
        for (let j = 0; j <= steps; j++) {
          const t = j / steps;
          const ang = a0 + turns * TAU * (1 - t);
          const y = y0 + t * dy;
          const r = trunkR(ang, y) + 0.035 * S;
          pts.push(new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r));
        }
        // 收尾时垂下一段绸带
        const tailN = 6;
        for (let j = 1; j <= tailN; j++) {
          const t = j / tailN;
          const last = pts[pts.length - 1];
          const ang = a0;
          const r = trunkR(ang, last.y) + 0.035 * S;
          pts.push(new THREE.Vector3(
            Math.cos(ang) * r + Math.sin(ang) * 0.12 * t * S,
            last.y - t * sag * S,
            Math.sin(ang) * r - Math.cos(ang) * 0.12 * t * S
          ));
        }

        const P = [], Nn = [], UV = [], idx = [];
        const total = pts.length - 1;
        for (let j = 0; j <= total; j++) {
          const p = pts[j];
          const prev = pts[Math.max(0, j - 1)];
          const next = pts[Math.min(total, j + 1)];
          const tang = new THREE.Vector3().subVectors(next, prev).normalize();
          const radial = new THREE.Vector3(p.x, 0, p.z).normalize();
          const upv = new THREE.Vector3().crossVectors(radial, tang).normalize();
          if (upv.lengthSq() < 1e-6) upv.set(0, 1, 0);
          const w = width * (1 - 0.25 * (j / total));
          P.push(p.x - upv.x * w, p.y - upv.y * w, p.z - upv.z * w);
          Nn.push(-radial.x, -radial.y, -radial.z); UV.push(0, j * 1.2);
          P.push(p.x + upv.x * w, p.y + upv.y * w, p.z + upv.z * w);
          Nn.push(-radial.x, -radial.y, -radial.z); UV.push(1, j * 1.2);
        }
        for (let j = 0; j < total; j++) {
          const a = j * 2, b = j * 2 + 1, c = (j + 1) * 2 + 1, d = (j + 1) * 2;
          idx.push(a, b, c, a, c, d);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
        g.setIndex(idx);
        const r = uvRect(0, 344, 256, 80, TAG.W, TAG.H);
        const uvA = g.attributes.uv;
        for (let i = 0; i < uvA.count; i++) uvA.setXY(i, r.u0 + (r.u1 - r.u0) * uvA.getX(i), r.v0 + (r.v1 - r.v0) * (uvA.getY(i) % 1));
        parts.push(g);
      }
      const merged = mergeGeometries(parts, false);
      tagGeo(merged, { grow: 0, span: 0.12, wind: 0.055 });
      const mat = inject(new THREE.MeshStandardMaterial({
        map: TAG.texture, color: 0xffffff, roughness: 0.52, metalness: 0.0,
        side: THREE.DoubleSide, emissive: 0x2a0404, emissiveIntensity: 1.0,
        envMapIntensity: 0.35,
      }), { grow: 'scale', wind: true, windFrom: 'position', swing: 0, ribbon: 0, windScale: 0.7 });
      return new THREE.Mesh(merged, mat);
    }
    const trunkWraps = buildTrunkWraps();
    scene.add(trunkWraps);

    /* ==========================================================================
     * 6. 地面 / 庭院 / 花瓣
     * ======================================================================== */

    /* ---------- 6.1 青石板地面 ---------- */
    {
      const g = new THREE.PlaneGeometry(120, 120, 1, 1);
      g.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        map: STONE.map, normalMap: STONE.normal, normalScale: new THREE.Vector2(0.9, 0.9),
        roughnessMap: STONE.rough, roughness: 1.0, metalness: 0.0,
        color: 0x9aa0aa, envMapIntensity: 0.28,
      });
      const ground = new THREE.Mesh(g, mat);
      ground.receiveShadow = true;
      scene.add(ground);
    }

    /* ---------- 6.2 地面落瓣 ---------- */
    {
      const g = new THREE.PlaneGeometry(0.17, 0.125);
      g.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({
        map: PETAL_TEX, alphaTest: 0.5, side: THREE.DoubleSide,
        roughness: 0.62, metalness: 0.0, color: 0xd8d8d8,
        emissive: 0x1e0302, emissiveIntensity: 1.0, envMapIntensity: 0.3,
      });
      const N = 1150;
      const mesh = new THREE.InstancedMesh(g, mat, N);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        const a = rand(0, TAU);
        const rr = 0.9 + Math.pow(rnd(), 0.55) * 11.5;
        const pos = new THREE.Vector3(Math.cos(a) * rr, 0.012 + rand(0, 0.012), Math.sin(a) * rr);
        q.setFromEuler(new THREE.Euler(rand(-0.16, 0.16), rand(0, TAU), rand(-0.16, 0.16)));
        sc.setScalar(rand(0.7, 1.5));
        m.compose(pos, q, sc);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }

    /* ---------- 6.3 空中飘落的花瓣（循环） ---------- */
    const FALL_N = 300;
    const FALL_H = 10.5;
    const fallPetal = { mesh: null, data: [] };
    {
      const g = new THREE.PlaneGeometry(0.155, 0.115);
      const mat = new THREE.MeshStandardMaterial({
        map: PETAL_TEX, alphaTest: 0.5, side: THREE.DoubleSide,
        roughness: 0.6, metalness: 0.0, color: 0xe8e8e8,
        emissive: 0x260403, emissiveIntensity: 1.0, envMapIntensity: 0.35,
        transparent: true, opacity: 0,
      });
      const mesh = new THREE.InstancedMesh(g, mat, FALL_N);
      mesh.frustumCulled = false;
      for (let i = 0; i < FALL_N; i++) {
        const a = rand(0, TAU);
        const rr = Math.pow(rnd(), 0.6) * 9.2;
        fallPetal.data.push({
          x: Math.cos(a) * rr,
          z: Math.sin(a) * rr,
          y0: rand(0, FALL_H),
          speed: rand(0.20, 0.46),
          swirl: rand(0.25, 0.85),
          phase: rand(0, TAU),
          spin: rand(0.25, 0.95),
          tilt: rand(0, TAU),
          scl: rand(0.75, 1.35),
        });
      }
      fallPetal.mesh = mesh;
      scene.add(mesh);
    }

    /* ---------- 6.4 中式庭院 ---------- */
    function buildCourtyard() {
      const group = new THREE.Group();
      const wallMat = new THREE.MeshStandardMaterial({
        map: STONE.map, normalMap: STONE.normal, roughnessMap: STONE.rough,
        color: 0x6d6a63, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.18,
      });
      const woodMat = new THREE.MeshStandardMaterial({
        color: 0x4a1f16, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.25,
      });
      const roofMat = new THREE.MeshStandardMaterial({
        color: 0x11161d, roughness: 0.9, metalness: 0.05, envMapIntensity: 0.3,
      });
      const latticeMat = new THREE.MeshStandardMaterial({
        map: LATTICE_TEX, emissiveMap: LATTICE_TEX, emissive: 0xff9a44,
        emissiveIntensity: 0.26, roughness: 0.8, metalness: 0.0, color: 0x101010,
      });

      const R = 15.5, WH = 5.2, WW = 0.55;

      // 三面围墙
      const walls = [
        { p: [0, WH / 2, -R], s: [R * 2 + WW, WH, WW] },
        { p: [-R, WH / 2, 0], s: [WW, WH, R * 2 + WW] },
        { p: [R, WH / 2, 0], s: [WW, WH, R * 2 + WW] },
      ];
      for (const w of walls) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(...w.s), wallMat);
        m.position.set(...w.p);
        m.castShadow = false;
        m.receiveShadow = true;
        group.add(m);
        // 檐口
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w.s[0] + 1.6, 0.42, w.s[2] + 1.6), roofMat);
        roof.position.set(w.p[0], WH + 0.22, w.p[2]);
        group.add(roof);
        const tile = new THREE.Mesh(new THREE.BoxGeometry(w.s[0] + 1.9, 0.55, w.s[2] + 1.9), roofMat);
        tile.position.set(w.p[0], WH + 0.62, w.p[2]);
        group.add(tile);
      }

      // 廊柱
      const pillarGeo = new THREE.CylinderGeometry(0.30, 0.34, WH + 0.4, 12);
      const plinthGeo = new THREE.CylinderGeometry(0.42, 0.46, 0.30, 12);
      const spots = [];
      for (let i = -2; i <= 2; i++) {
        spots.push([i * 5.6, -R + 0.9, 1]);
        if (Math.abs(i) >= 1) { spots.push([-R + 0.9, i * 5.6, 0]); spots.push([R - 0.9, i * 5.6, 0]); }
      }
      for (const [x, z] of spots) {
        const p = new THREE.Mesh(pillarGeo, woodMat);
        p.position.set(x, WH / 2, z);
        p.castShadow = true;
        p.receiveShadow = true;
        group.add(p);
        const b = new THREE.Mesh(plinthGeo, wallMat);
        b.position.set(x, 0.15, z);
        group.add(b);
      }

      // 格栅窗（后墙 + 侧墙）
      const winGeo = new THREE.PlaneGeometry(2.5, 1.7);
      for (let i = -2; i <= 2; i++) {
        const w = new THREE.Mesh(winGeo, latticeMat);
        w.position.set(i * 5.6, 2.9, -R + 0.30);
        group.add(w);
      }
      for (let i = -1; i <= 1; i++) {
        const wl = new THREE.Mesh(winGeo, latticeMat);
        wl.position.set(-R + 0.30, 2.9, i * 5.6);
        wl.rotation.y = Math.PI / 2;
        group.add(wl);
        const wr = wl.clone();
        wr.position.x = R - 0.30;
        group.add(wr);
      }

      // 台明 / 阶石
      const stepMat = wallMat;
      const steps = [
        { p: [0, 0.075, -R + 1.9], s: [R * 2, 0.15, 3.4] },
        { p: [-R + 1.9, 0.075, 0], s: [3.4, 0.15, R * 2] },
        { p: [R - 1.9, 0.075, 0], s: [3.4, 0.15, R * 2] },
      ];
      for (const s of steps) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(...s.s), stepMat);
        m.position.set(...s.p);
        m.receiveShadow = true;
        group.add(m);
      }

      return group;
    }
    const courtyard = buildCourtyard();
    scene.add(courtyard);

    /* ---------- 6.5 廊下灯笼（挂点固定，只做轻微摆动） ---------- */
    const wallLanterns = [];
    function addWallLantern(x, z, y, scale = 1.55, swing = 0.045) {
      const geo = buildLanternGeo();
      tagGeo(geo, { grow: 0, span: 0.1, wind: 0.12 });
      const mat = inject(new THREE.MeshStandardMaterial({
        color: 0x180a04, emissive: 0xff7c1e, emissiveIntensity: 0.98,
        roughness: 0.6, metalness: 0.0, envMapIntensity: 0.3,
      }), { grow: 'none', wind: true, windFrom: 'position', swing, ribbon: 0, windScale: 0.8 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(scale);
      scene.add(mesh);
      wallLanterns.push(mesh);
      return mesh;
    }

    /* ==========================================================================
     * 7. 灯光   —— 环境极暗，主光全部来自树上灯笼的暖黄柔光
     * ======================================================================== */

    const hemi = new THREE.HemisphereLight(0x16223a, 0x030406, 0.055);
    scene.add(hemi);

    const moon = new THREE.DirectionalLight(0x4f6ea8, 0.13);
    moon.position.set(-9, 15, -12);
    scene.add(moon);

    // 主光：树冠之内的暖黄柔光（唯一投影光源）
    const keySpot = new THREE.SpotLight(0xffb070, 92, 0, 1.15, 0.92, 2.0);
    keySpot.position.set(0.5, 12.6, 3.2);
    keySpot.target.position.set(0, 2.6, 0);
    keySpot.castShadow = true;
    keySpot.shadow.mapSize.set(2048, 2048);
    keySpot.shadow.camera.near = 1.2;
    keySpot.shadow.camera.far = 34;
    keySpot.shadow.bias = -0.0007;
    keySpot.shadow.normalBias = 0.035;
    keySpot.shadow.radius = 3;
    scene.add(keySpot, keySpot.target);

    // 补光：从正面偏侧洒一点暖光，把树从黑背景里拉出来
    const fillSpot = new THREE.SpotLight(0xff9a4a, 20, 0, 1.10, 1.0, 2.0);
    fillSpot.position.set(-6.5, 7.2, 11.5);
    fillSpot.target.position.set(0, 4.2, 0);
    scene.add(fillSpot, fillSpot.target);

    // 灯笼点光（数量受限，保证性能）
    const lanternLights = [];
    const spots = hangings.lanternSpots;
    const lightIdx = [];
    {
      const step = Math.max(1, Math.floor(spots.length / 9));
      for (let i = 0; i < spots.length && lightIdx.length < 9; i += step) lightIdx.push(i);
    }
    for (const i of lightIdx) {
      const p = spots[i];
      const l = new THREE.PointLight(0xffa04c, 4.2, 16, 1.6);
      l.position.copy(p);
      l.position.y -= 0.62;
      scene.add(l);
      lanternLights.push(l);
    }

    // 低处的灯笼余晖：从树冠缝隙落到树干与地面（不投影，让光能到地面）
    const lowLights = [];
    for (const [lx, ly, lz, li] of [[1.9, 3.2, 0.4, 8.5], [-1.6, 3.6, 1.5, 7.0], [0.2, 3.0, -2.4, 6.2]]) {
      const l = new THREE.PointLight(0xff9a45, li, 18, 1.5);
      l.position.set(lx, ly, lz);
      scene.add(l);
      lowLights.push(l);
    }
    // 树干前方的低灯笼：专门照亮粗糙树皮（参考图里树干是被暖光打亮的）
    const barkLights = [];
    for (const [lx, ly, lz, li] of [[3.6, 2.4, 3.9, 7.0], [-3.7, 2.1, 3.2, 5.8], [0.6, 4.2, 5.6, 6.4], [-4.5, 3.2, -3.4, 4.6]]) {
      const l = new THREE.PointLight(0xffa054, li, 16, 1.35);
      l.position.set(lx, ly, lz);
      scene.add(l);
      barkLights.push(l);
    }

    // 廊下灯笼的点光
    function addPoint(x, y, z, intensity, dist) {
      const l = new THREE.PointLight(0xff9a44, intensity, dist, 1.6);
      l.position.set(x, y, z);
      scene.add(l);
      return l;
    }
    const porchLights = [
      addPoint(-7.6, 4.5, -2.4, 5.0, 15),
      addPoint(7.6, 4.5, -2.4, 5.0, 15),
    ];
    addWallLantern(-7.6, -2.4, 5.9, 1.55);
    addWallLantern(7.6, -2.4, 5.9, 1.55);
    addWallLantern(-12.4, 2.6, 5.6, 1.35, 0.035);
    addWallLantern(12.4, -2.6, 5.6, 1.35, 0.035);

    /* ---------- 7.1 光晕 + 体积光 ---------- */
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: GLOW_TEX, color: 0xff9040, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, opacity: 0.0,
    }));
    halo.scale.set(15, 15, 1);
    halo.position.set(0, 5.6, -1.2);
    scene.add(halo);

    const beams = [];
    {
      const mat = new THREE.MeshBasicMaterial({
        map: BEAM_TEX, color: 0xffb070, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      // 从树冠斜射到地面的朦胧光束（底端留在离地一点，避免切断地面）
      const defs = [
        { a: 0.35, r: 3.2, top: 8.8, h: 7.6, w: 3.2, o: 0.026 },
        { a: 1.95, r: 4.4, top: 8.2, h: 7.0, w: 2.6, o: 0.021 },
        { a: 3.55, r: 2.9, top: 9.1, h: 7.9, w: 2.8, o: 0.023 },
        { a: 5.05, r: 4.7, top: 8.4, h: 7.2, w: 2.5, o: 0.018 },
      ];
      for (const d of defs) {
        for (let k = 0; k < 2; k++) {
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), mat.clone());
          plane.material.opacity = d.o;
          plane.position.set(Math.cos(d.a) * d.r, d.top - d.h / 2, Math.sin(d.a) * d.r);
          plane.rotation.y = -d.a + k * Math.PI / 2;
          plane.userData.baseOpacity = d.o;
          plane.userData.phase = rand(0, TAU);
          plane.frustumCulled = false;
          scene.add(plane);
          beams.push(plane);
        }
      }
    }

    /* ==========================================================================
     * 8. 树苗（初始状态）
     * ======================================================================== */

    function buildSapling() {
      const g = new THREE.Group();
      const stemMat = new THREE.MeshStandardMaterial({
        color: 0x4a3320, roughness: 0.9, metalness: 0.0, emissive: 0x140b04, emissiveIntensity: 1.0,
      });
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.035, 0.16, 0.015),
        new THREE.Vector3(-0.015, 0.33, 0.05),
        new THREE.Vector3(0.025, 0.5, 0.02),
      ]);
      const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.019, 7, false), stemMat);
      stem.castShadow = true;
      g.add(stem);

      const leafMat = new THREE.MeshStandardMaterial({
        color: 0x35502a, roughness: 0.65, metalness: 0.0,
        side: THREE.DoubleSide, emissive: 0x0b1406, emissiveIntensity: 1.0,
      });
      const leafGeo = new THREE.SphereGeometry(0.075, 9, 7);
      const leaves = [
        [-0.085, 0.37, 0.02, 0.55],
        [0.095, 0.27, -0.03, -0.5],
        [0.03, 0.50, 0.05, 0.25],
        [-0.05, 0.52, -0.02, -0.3],
      ];
      for (const [x, y, z, rot] of leaves) {
        const l = new THREE.Mesh(leafGeo, leafMat);
        l.position.set(x, y, z);
        l.scale.set(1.0, 0.20, 0.52);
        l.rotation.set(0.22, rot, rot * 0.6);
        g.add(l);
      }

      const budMat = new THREE.MeshStandardMaterial({
        color: 0xff3a24, emissive: 0xd42311, emissiveIntensity: 1.5, roughness: 0.55,
      });
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(rand(0.016, 0.024), 8, 6), budMat);
        b.position.set(rand(-0.06, 0.06), rand(0.33, 0.56), rand(-0.05, 0.05));
        g.add(b);
      }

      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: GLOW_TEX, color: 0xffb070, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0.5,
      }));
      glow.scale.set(1.5, 1.5, 1);
      glow.position.set(0, 0.34, 0);
      g.add(glow);

      const light = new THREE.PointLight(0xffa054, 1.5, 6.5, 2.0);
      light.position.set(0, 0.45, 0);
      g.add(light);

      g.userData = { glow, light, mats: [stemMat, leafMat, budMat] };
      return g;
    }
    const sapling = buildSapling();
    scene.add(sapling);

    /* ==========================================================================
     * 9. 交互与状态机
     * ======================================================================== */

    const state = {
      started: false,
      grow: 0,          // 0..1 生长进度
      elapsed: 0,
      sapFade: 1,
      flash: 0,
    };

    const hintEl = document.getElementById('hint');
    const loaderEl = document.getElementById('loader');

    if (STILL && hintEl) hintEl.classList.add('gone');

    function startGrowth() {
      if (state.started) return;
      state.started = true;
      state.flash = 1;
      if (hintEl) hintEl.classList.add('gone');
    }
    renderer.domElement.addEventListener('pointerdown', startGrowth, { once: false });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') startGrowth();
    });

    if (DEBUG_GROW !== null) {
      state.started = true;
      state.grow = DEBUG_GROW;
      state.elapsed = DEBUG_GROW * CFG.growDuration;
      state.sapFade = DEBUG_GROW > 0.02 ? 0 : 1;
      if (hintEl) hintEl.classList.add('gone');
      // 让调试截图也落在与进度匹配的机位上
      const dk = clamp((DEBUG_GROW - 0.02) / 0.62, 0, 1);
      const de = dk * dk * (3 - 2 * dk);
      camera.position.lerpVectors(CAM_A.pos, CAM_B.pos, de);
      controls.target.lerpVectors(CAM_A.tgt, CAM_B.tgt, de);
      controls.update();
      if (DEBUG_GROW > 0.02) sapling.visible = false;
    } else if (QUERY.get('autostart') === '1') {
      // 调试用：不需要点击，自动走一遍完整生长
      setTimeout(startGrowth, 500);
    }
    // 调试用：只看枝干骨架（隐藏花团），方便检查枝形
    if (QUERY.get('nobloom') === '1') flowers.visible = false;

    /* ==========================================================================
     * 10. 主循环
     * ======================================================================== */

    const clock = new THREE.Clock();
    const tmpM = new THREE.Matrix4();
    const tmpQ = new THREE.Quaternion();
    const tmpE = new THREE.Euler();
    const tmpS = new THREE.Vector3();
    const tmpV = new THREE.Vector3();

    function updateFallingPetals(t, dt) {
      const mesh = fallPetal.mesh;
      const N = fallPetal.data.length;
      const fade = clamp((state.grow - 0.80) / 0.18, 0, 1);
      mesh.material.opacity = fade;
      mesh.visible = fade > 0.001;
      if (!mesh.visible) return;
      for (let i = 0; i < N; i++) {
        const p = fallPetal.data[i];
        const y = FALL_H - ((t * p.speed + p.y0) % FALL_H);
        const sw = p.swirl;
        const x = p.x + Math.sin(t * 0.30 + p.phase) * sw;
        const z = p.z + Math.cos(t * 0.24 + p.phase * 1.3) * sw;
        tmpE.set(
          p.tilt + Math.sin(t * p.spin + p.phase) * 0.7,
          t * p.spin * 0.55 + p.phase,
          Math.cos(t * p.spin * 0.8 + p.phase) * 0.6
        );
        tmpQ.setFromEuler(tmpE);
        tmpS.setScalar(p.scl);
        tmpV.set(x, y, z);
        tmpM.compose(tmpV, tmpQ, tmpS);
        mesh.setMatrixAt(i, tmpM);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    function animate() {
      requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;

      if (state.started && DEBUG_GROW === null) {
        state.elapsed += dt;
        state.grow = clamp(state.elapsed / CFG.growDuration, 0, 1);
      }
      const g = state.grow;
      const ease = g * g * (3 - 2 * g);

      // 风：生长后期逐渐起风，成熟后稳定（幅度始终很轻）
      const windAmt = CFG.windBase * clamp((g - 0.10) / 0.75, 0, 1) * (0.55 + 0.45 * ease);
      uniforms.uTime.value = t;
      uniforms.uProgress.value = g;
      uniforms.uWind.value = windAmt;

      // 树本体
      treeMesh.visible = g > 0.002;
      trunkWraps.visible = g > 0.02;

      // 灯光随生长渐亮
      const ramp = 0.24 + 0.76 * ease;
      keySpot.intensity = 92 * ramp;
      fillSpot.intensity = 20 * ramp;
      porchLights.forEach((l) => { l.intensity = 4.6 * ramp; });
      lanternLights.forEach((l) => { l.intensity = 4.2 * ramp; });
      lowLights.forEach((l, i) => { l.intensity = [8.5, 7.0, 6.2][i] * ramp; });
      barkLights.forEach((l, i) => { l.intensity = [7.0, 5.8, 6.4, 4.6][i] * ramp; });
      halo.material.opacity = 0.135 * ramp;
      for (const b of beams) {
        const flick = 0.80 + 0.20 * Math.sin(t * 0.55 + b.userData.phase);
        b.material.opacity = b.userData.baseOpacity * ramp * flick;
      }
      hemi.intensity = 0.055 * (0.5 + 0.5 * ease);

      // 点击瞬间的暖光涌动
      if (state.flash > 0) {
        state.flash = Math.max(0, state.flash - dt / 1.6);
        const f = state.flash;
        keySpot.intensity += 180 * f * f;
        halo.material.opacity += 0.34 * f * f;
      }

      // 树苗：等待时轻微呼吸，点击后淡出
      if (sapling.visible) {
        const ud = sapling.userData;
        if (!state.started) {
          sapling.rotation.z = Math.sin(t * 0.9) * 0.03;
          sapling.rotation.x = Math.cos(t * 0.7) * 0.02;
          ud.glow.material.opacity = 0.42 + Math.sin(t * 1.7) * 0.15;
          ud.light.intensity = 1.25 + Math.sin(t * 1.7) * 0.35;
          ud.glow.scale.setScalar(1.45 + Math.sin(t * 1.7) * 0.16);
        } else {
          state.sapFade = Math.max(0, state.sapFade - dt / 1.05);
          const f = state.sapFade;
          sapling.scale.setScalar(Math.max(0.0001, f * f));
          sapling.rotation.z += dt * 0.6;
          ud.mats.forEach((m) => { m.transparent = true; m.opacity = f; });
          ud.glow.material.opacity = 0.5 * f;
          ud.light.intensity = 1.6 * f;
          if (f <= 0.001) sapling.visible = false;
        }
      }

      updateFallingPetals(t, dt);

      // 相机：生长前段轻微推镜（用户一动就交出控制权）
      if (!userMoved && state.started && DEBUG_GROW === null) {
        const k = clamp((g - 0.02) / 0.62, 0, 1);
        const e = k * k * (3 - 2 * k);
        camera.position.lerpVectors(CAM_A.pos, CAM_B.pos, e);
        controls.target.lerpVectors(CAM_A.tgt, CAM_B.tgt, e);
      }

      controls.update();
      composer.render();
    }

    /* ==========================================================================
     * 11. 尺寸自适应 / 启动
     * ======================================================================== */

    function onResize() {
      const w = window.innerWidth, h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
      bloom.setSize(w, h);
    }
    window.addEventListener('resize', onResize);

    renderer.compile(scene, camera);
    composer.render();
    requestAnimationFrame(() => {
      if (loaderEl) loaderEl.classList.add('done');
      setTimeout(() => { if (loaderEl && loaderEl.parentNode) loaderEl.parentNode.removeChild(loaderEl); }, 1200);
    });
    animate();

    // 便于调试
    window.__WISH_TREE__ = { scene, camera, renderer, composer, uniforms, state, treeData };
    if (DEBUG_GROW !== null) {
      console.log('[wish-tree] 高度=%s 宽度=%s 缩放=%s 枝段=%s 花团=%s 取景距离=%s',
        treeData.height.toFixed(2), treeData.spread.toFixed(2), treeData.scale.toFixed(3),
        treeData.segments.length, flowers.count, treeData.fit.dist.toFixed(2));
      console.log('[wish-tree] 树干顶点=%s 花团实例=%s', treeMesh.geometry.attributes.position.count, flowers.count);
    }

  }).catch((err) => {
    console.error(err);
    const el = document.getElementById('loader');
    if (el) {
      const p = el.querySelector('p');
      if (p) {
        p.style.letterSpacing = '.1em';
        p.style.color = 'rgba(255,170,140,.75)';
        p.textContent = '场景加载失败：' + (err && err.message ? err.message : err);
      }
    }
  });
})();
