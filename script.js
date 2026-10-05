// ============================================================
// Helmholtz Particle Simulation — Frontend (Three.js)
//
// 粒子效果升级：
//   - 发光粒子（自发光核心 + 径向光晕，脉动呼吸）
//   - 渐变发光轨迹（蓝紫 -> 亮青）
//   - 管状铜导线线圈（PBR 金属材质，投射/接收阴影）
//   - 三光源系统（半球光 + 主光 + 暖色补光）
//   - ACES 色调映射 + Bloom 辉光（仅高亮粒子/轨迹发光）
//   - 实验台地面 + 网格参考线
//
// 注意：本文件是普通脚本（非 module），依赖 index.html 中
// module 脚本把 THREE / OrbitControls / EffectComposer /
// RenderPass / UnrealBloomPass 挂载到 window。
// ============================================================

// Global state
let scene;
let camera;
let renderer;
let controls;
let composer;

let particle;
let particleGlow;
let trajectoryLine;
let coil1Mesh;
let coil2Mesh;

let trajectoryPoints = [];
let times = [];

let currentIndex = 0;
let isPlaying = false;

let animationSpeed = 1;


// ============================================================
// Start application
// ============================================================

window.startSimulationApp = function () {

    console.log("Starting simulation app...");

    initializeThreeJS();

    setupButtons();

    checkBackend();

};


// ============================================================
// Initialize Three.js
// ============================================================

function initializeThreeJS() {

    const THREE = window.THREE;
    const OrbitControls = window.OrbitControls;

    if (!THREE) {

        console.error("Three.js was not loaded.");

        return;

    }

    if (!OrbitControls) {

        console.error("OrbitControls was not loaded.");

        return;

    }

    if (
        !window.EffectComposer ||
        !window.RenderPass ||
        !window.UnrealBloomPass
    ) {

        console.error("Post-processing modules were not loaded.");

        return;

    }


    // --------------------------------------------------------
    // Viewer
    // --------------------------------------------------------

    const viewer = document.getElementById("viewer");

    if (!viewer) {

        console.error("Viewer element not found.");

        return;

    }

    const width = viewer.clientWidth;
    const height = viewer.clientHeight;


    // --------------------------------------------------------
    // Scene
    // --------------------------------------------------------

    scene = new THREE.Scene();

    scene.background = new THREE.Color(0x05070a);


    // --------------------------------------------------------
    // Camera
    // --------------------------------------------------------

    camera = new THREE.PerspectiveCamera(
        45,
        width / height,
        0.001,
        100
    );

    camera.position.set(0.32, 0.26, 0.38);

    camera.lookAt(0, 0, 0);


    // --------------------------------------------------------
    // Renderer
    // --------------------------------------------------------

    renderer = new THREE.WebGLRenderer({ antialias: true });

    renderer.setPixelRatio(window.devicePixelRatio);

    renderer.setSize(width, height);

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    viewer.appendChild(renderer.domElement);


    // --------------------------------------------------------
    // Camera controls
    // --------------------------------------------------------

    controls = new OrbitControls(camera, renderer.domElement);

    controls.enableDamping = true;

    controls.target.set(0, 0, 0);


    // --------------------------------------------------------
    // Lights
    // --------------------------------------------------------

    // 半球光：营造空间环境（天空蓝 + 地面暗色）
    const hemiLight = new THREE.HemisphereLight(
        0x8fb8ff,
        0x14181e,
        0.55
    );

    scene.add(hemiLight);


    // 主光（右前上方），投射阴影
    const dirLight = new THREE.DirectionalLight(0xfff2e0, 2.2);

    dirLight.position.set(0.4, 0.5, 0.35);

    dirLight.castShadow = true;

    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;

    // 阴影相机范围（场景尺度较小）
    dirLight.shadow.camera.left = -0.4;
    dirLight.shadow.camera.right = 0.4;
    dirLight.shadow.camera.top = 0.4;
    dirLight.shadow.camera.bottom = -0.4;
    dirLight.shadow.camera.near = 0.01;
    dirLight.shadow.camera.far = 2;

    scene.add(dirLight);


    // 背面暖色补光：让铜线圈暗面有轮廓
    const fillLight = new THREE.DirectionalLight(0x4488ff, 0.7);

    fillLight.position.set(-0.3, -0.2, -0.4);

    scene.add(fillLight);


    // --------------------------------------------------------
    // 实验台（地面，承接阴影）
    // --------------------------------------------------------

    const floorMat = new THREE.MeshStandardMaterial({
        color: 0x141a22,
        roughness: 0.55,
        metalness: 0.2
    });

    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.9),
        floorMat
    );

    floor.rotation.x = -Math.PI / 2;

    floor.position.y = -0.16;

    floor.receiveShadow = true;

    scene.add(floor);


    // 网格参考线
    const grid = new THREE.GridHelper(0.9, 18, 0x2c3947, 0x1c252f);

    grid.position.y = -0.159;

    scene.add(grid);


    // --------------------------------------------------------
    // Coordinate axes
    // --------------------------------------------------------

    const axesHelper = new THREE.AxesHelper(0.2);

    scene.add(axesHelper);


    // --------------------------------------------------------
    // Particle（发光核心 + 光晕）
    // --------------------------------------------------------

    const particleGeometry = new THREE.SphereGeometry(0.006, 24, 24);

    const particleMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x66ffff,
        emissiveIntensity: 2.0,
        roughness: 0.3,
        metalness: 0.1
    });

    particle = new THREE.Mesh(particleGeometry, particleMaterial);

    particle.visible = false;


    // 粒子光晕（Billboard 贴花，始终面向相机）
    const glowTexture = createGlowTexture();

    const glowMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0x66ffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    particleGlow = new THREE.Sprite(glowMaterial);

    particleGlow.scale.set(0.05, 0.05, 1);

    particle.add(particleGlow);

    scene.add(particle);


    // --------------------------------------------------------
    // Post-processing（Bloom 辉光）
    // --------------------------------------------------------

    const EffectComposer = window.EffectComposer;
    const RenderPass = window.RenderPass;
    const UnrealBloomPass = window.UnrealBloomPass;

    composer = new EffectComposer(renderer);

    composer.addPass(new RenderPass(scene, camera));

    // strength: 辉光强度, radius: 光晕扩散, threshold: 亮度阈值
    // threshold=0.85 -> 只有高亮的粒子/轨迹发光，铜线圈不发光
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.55,
        0.4,
        0.85
    );

    composer.addPass(bloomPass);


    // --------------------------------------------------------
    // Window resize
    // --------------------------------------------------------

    window.addEventListener("resize", resizeRenderer);


    // --------------------------------------------------------
    // Animation loop
    // --------------------------------------------------------

    animate();

}


// ============================================================
// 生成径向渐变光晕贴图
// ============================================================

function createGlowTexture() {

    const THREE = window.THREE;

    const size = 128;

    const canvas = document.createElement("canvas");

    canvas.width = size;

    canvas.height = size;

    const ctx = canvas.getContext("2d");

    const g = ctx.createRadialGradient(
        size / 2, size / 2, 0,
        size / 2, size / 2, size / 2
    );

    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(120,255,255,0.8)");
    g.addColorStop(0.6, "rgba(0,220,255,0.25)");
    g.addColorStop(1, "rgba(0,180,255,0)");

    ctx.fillStyle = g;

    ctx.fillRect(0, 0, size, size);

    return new THREE.CanvasTexture(canvas);

}


// ============================================================
// Animation
// ============================================================

function animate() {

    requestAnimationFrame(animate);

    if (
        isPlaying &&
        trajectoryPoints.length > 0
    ) {

        currentIndex += animationSpeed;

        currentIndex = Math.floor(currentIndex);

        if (currentIndex >= trajectoryPoints.length) {

            currentIndex = trajectoryPoints.length - 1;

            isPlaying = false;

        }

        updateParticle(currentIndex);

    }


    // 粒子光晕脉动 + 自转，增强动态感
    if (particle && particle.visible && particleGlow) {

        const pulse = 1 + 0.12 * Math.sin(Date.now() / 120);

        particleGlow.scale.set(
            0.05 * pulse,
            0.05 * pulse,
            1
        );

        particle.rotation.y += 0.05;

    }


    if (controls) {

        controls.update();

    }


    if (composer) {

        composer.render();

    } else if (renderer && scene && camera) {

        renderer.render(scene, camera);

    }

}


// ============================================================
// 创建管状铜线圈（PBR 材质）
// ============================================================

function createCoil(points) {

    const THREE = window.THREE;

    const vectorPoints = points.map(
        p => new THREE.Vector3(p[0], p[1], p[2])
    );


    // 闭合圆环曲线
    const curve = new THREE.CatmullRomCurve3(
        vectorPoints,
        true,
        "catmullrom",
        0.5
    );


    // 线圈半径 = 点到圆心的平均距离
    const center = new THREE.Vector3();

    vectorPoints.forEach(v => center.add(v));

    center.divideScalar(vectorPoints.length);

    const coilRadius = vectorPoints[0].distanceTo(center);


    // 管径按线圈半径自适应，视觉明显又不遮挡轨迹
    const tubeRadius = Math.max(coilRadius * 0.02, 0.003);


    const geometry = new THREE.TubeGeometry(
        curve,
        200,
        tubeRadius,
        12,
        false
    );


    // 铜 PBR 材质
    const material = new THREE.MeshPhysicalMaterial({
        color: 0xc07a3a,
        metalness: 0.95,
        roughness: 0.28,
        clearcoat: 0.15,
        clearcoatRoughness: 0.25,
        envMapIntensity: 1.2
    });


    const mesh = new THREE.Mesh(geometry, material);

    mesh.castShadow = true;

    mesh.receiveShadow = true;

    return mesh;

}


// ============================================================
// 创建渐变发光轨迹（蓝紫 -> 亮青）
// ============================================================

function createTrajectory(points) {

    const THREE = window.THREE;

    const vectorPoints = points.map(
        p => new THREE.Vector3(p[0], p[1], p[2])
    );

    const geometry = new THREE.BufferGeometry().setFromPoints(
        vectorPoints
    );


    // 顶点颜色渐变
    const count = vectorPoints.length;

    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {

        const t = count <= 1 ? 0 : i / (count - 1);

        colors[i * 3 + 0] = 0.15 + 0.10 * t;   // R
        colors[i * 3 + 1] = 0.40 + 0.60 * t;   // G
        colors[i * 3 + 2] = 1.00;              // B

    }

    geometry.setAttribute(
        "color",
        new THREE.BufferAttribute(colors, 3)
    );


    const material = new THREE.LineBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.9
    });


    const line = new THREE.Line(geometry, material);

    line.frustumCulled = false;

    return line;

}


// ============================================================
// Update particle position
// ============================================================

function updateParticle(index) {

    if (
        !particle ||
        trajectoryPoints.length === 0
    ) {

        return;

    }

    const p = trajectoryPoints[index];

    particle.position.set(p[0], p[1], p[2]);

    particle.visible = true;


    // Timeline
    const timeline = document.getElementById("timeline");

    if (timeline) {

        timeline.max = trajectoryPoints.length - 1;

        timeline.value = index;

    }


    // Time display
    const timeDisplay = document.getElementById("time-display");

    if (timeDisplay && times.length > index) {

        timeDisplay.textContent =
            "t = " +
            formatScientific(times[index]) +
            " s";

    }

}


// ============================================================
// Fit camera
// ============================================================

function fitCamera(points) {

    const THREE = window.THREE;

    if (!points || points.length === 0) {

        return;

    }


    const box = new THREE.Box3();

    for (const p of points) {

        box.expandByPoint(
            new THREE.Vector3(p[0], p[1], p[2])
        );

    }


    // 把实验台也纳入视野
    box.expandByPoint(new THREE.Vector3(0, -0.16, 0));


    const center = new THREE.Vector3();

    box.getCenter(center);


    const size = new THREE.Vector3();

    box.getSize(size);


    const maxSize = Math.max(
        size.x,
        size.y,
        size.z,
        0.1
    );

    const dist = maxSize * 1.8;


    camera.position.set(
        center.x + dist,
        center.y + dist * 0.9,
        center.z + dist
    );

    camera.lookAt(center);

    controls.target.copy(center);

    controls.update();

}


// ============================================================
// Run simulation
// ============================================================

function runSimulation() {

    console.log("Running local simulation...");


    // --------------------------------------------------------
    // Collect parameters
    // --------------------------------------------------------

    const params = {

        q: parseFloat(document.getElementById("q").value),

        m: parseFloat(document.getElementById("m").value),

        x0: parseFloat(document.getElementById("x0").value),

        y0: parseFloat(document.getElementById("y0").value),

        z0: parseFloat(document.getElementById("z0").value),

        vx0: parseFloat(document.getElementById("vx0").value),

        vy0: parseFloat(document.getElementById("vy0").value),

        vz0: parseFloat(document.getElementById("vz0").value),

        R: parseFloat(document.getElementById("R").value),

        N: parseInt(document.getElementById("N").value),

        I: parseFloat(document.getElementById("I").value),

        num_periods: parseFloat(
            document.getElementById("num_periods").value
        ),

        steps_per_period: parseInt(
            document.getElementById("steps_per_period").value
        )

    };


    console.log("Parameters:", params);


    try {

        // ----------------------------------------------------
        // 在浏览器本地运行纯 JS 物理引擎（无需后端）
        // ----------------------------------------------------

        const result = runSimulationJS(params);


        console.log("Simulation result:", result);


        if (!result.success) {

            alert("Simulation failed:\n" + result.error);

            return;

        }


        const data = result.data;


        // ----------------------------------------------------
        // Save trajectory
        // ----------------------------------------------------

        trajectoryPoints = data.positions;

        times = data.times;

        currentIndex = 0;

        isPlaying = false;


        // ----------------------------------------------------
        // Remove previous objects
        // ----------------------------------------------------

        if (trajectoryLine) {

            scene.remove(trajectoryLine);

            trajectoryLine.geometry.dispose();

            trajectoryLine.material.dispose();

            trajectoryLine = null;

        }

        if (coil1Mesh) {

            scene.remove(coil1Mesh);

            coil1Mesh.geometry.dispose();

            coil1Mesh.material.dispose();

            coil1Mesh = null;

        }

        if (coil2Mesh) {

            scene.remove(coil2Mesh);

            coil2Mesh.geometry.dispose();

            coil2Mesh.material.dispose();

            coil2Mesh = null;

        }


        // ----------------------------------------------------
        // Create coils
        // ----------------------------------------------------

        coil1Mesh = createCoil(data.coil1);

        coil2Mesh = createCoil(data.coil2);

        scene.add(coil1Mesh);

        scene.add(coil2Mesh);


        // ----------------------------------------------------
        // Create trajectory
        // ----------------------------------------------------

        trajectoryLine = createTrajectory(trajectoryPoints);

        scene.add(trajectoryLine);


        // ----------------------------------------------------
        // Particle
        // ----------------------------------------------------

        updateParticle(0);


        // ----------------------------------------------------
        // Camera（轨迹 + 线圈 + 实验台整体取景）
        // ----------------------------------------------------

        fitCamera([
            ...trajectoryPoints,
            ...data.coil1,
            ...data.coil2
        ]);


        // ----------------------------------------------------
        // Update results
        // ----------------------------------------------------

        updateResults(data);


        console.log("Simulation completed.");

    }

    catch (error) {

        console.error(error);

        alert("Simulation failed:\n" + error);

    }

}


// ============================================================
// Update result cards
// ============================================================

function updateResults(data) {

    setText(
        "B-center",
        formatScientific(data.B_center) + " T"
    );

    setText(
        "field-error",
        data.field_error_percent.toFixed(4) + " %"
    );

    setText(
        "cyclotron-period",
        formatScientific(data.cyclotron_period) + " s"
    );

    setText(
        "dt",
        formatScientific(data.dt) + " s"
    );

    setText(
        "total-time",
        formatScientific(data.total_time) + " s"
    );

    setText(
        "energy-error",
        data.energy_error_percent.toFixed(6) + " %"
    );

}


// ============================================================
// Helper
// ============================================================

function setText(id, value) {

    const element = document.getElementById(id);

    if (element) {

        element.textContent = value;

    }

}


// ============================================================
// Scientific notation
// ============================================================

function formatScientific(value) {

    return Number(value).toExponential(3);

}


// ============================================================
// Buttons
// ============================================================

function setupButtons() {

    const runButton = document.getElementById("run-button");

    const playButton = document.getElementById("play-button");

    const pauseButton = document.getElementById("pause-button");

    const resetButton = document.getElementById("reset-button");

    const timeline = document.getElementById("timeline");


    if (runButton) {

        runButton.addEventListener("click", runSimulation);

    }


    if (playButton) {

        playButton.addEventListener("click", function () {

            if (trajectoryPoints.length > 0) {

                isPlaying = true;

            }

        });

    }


    if (pauseButton) {

        pauseButton.addEventListener("click", function () {

            isPlaying = false;

        });

    }


    if (resetButton) {

        resetButton.addEventListener("click", function () {

            isPlaying = false;

            currentIndex = 0;

            updateParticle(0);

        });

    }


    if (timeline) {

        timeline.addEventListener("input", function () {

            isPlaying = false;

            currentIndex = parseInt(timeline.value);

            updateParticle(currentIndex);

        });

    }

}


// ============================================================
// Check backend
// ============================================================

function checkBackend() {

    // 纯前端模式：所有计算在浏览器本地完成，不再依赖后端。
    // 状态栏直接标记本地引擎就绪。

    const statusElement = document.getElementById("status");

    if (statusElement) {

        statusElement.textContent = "LOCAL ENGINE READY";

    }

}


// ============================================================
// Resize
// ============================================================

function resizeRenderer() {

    const viewer = document.getElementById("viewer");

    if (!viewer || !renderer || !camera) {

        return;

    }

    const w = viewer.clientWidth;

    const h = viewer.clientHeight;

    camera.aspect = w / h;

    camera.updateProjectionMatrix();

    renderer.setSize(w, h);

    if (composer) {

        composer.setSize(w, h);

    }

}
