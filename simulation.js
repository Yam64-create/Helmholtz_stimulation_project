// ============================================================
// Helmholtz Particle Simulation — 纯前端物理引擎
//
// 本文件把原 Python 后端 simulation.py 逐函数移植为 JavaScript，
// 使全部物理计算在浏览器本地完成，不再依赖任何后端/服务器。
//
// 对应移植关系：
//   simulation.py:build_coils               -> buildCoils
//   simulation.py:magnetic_field            -> magneticField
//   simulation.py:theoretical_center_field  -> theoreticalCenterField
//   simulation.py:acceleration              -> acceleration
//   simulation.py:rk4_step                  -> rk4Step
//   simulation.py:run_simulation            -> runSimulationJS
//
// 用法（浏览器）：
//   runSimulationJS(params)
//   返回结构与原后端 /api/simulate 完全一致：
//   { success: true, data: {...} }  或  { success: false, error: "..." }
//
// 本文件是普通脚本（非 module），在浏览器中定义全局函数；
// 同时支持在 Node 中 require 以便离线验证。
// ============================================================

// ============================================================
// 1. Physical constants
// ============================================================

var MU0 = 4 * Math.PI * 1e-7;


// ============================================================
// 2. Build Helmholtz coils
//   返回 { coil1, coil2, segmentVectors, segmentMidpoints }
// ============================================================

function buildCoils(R, separation, numSegments) {

    var coil1 = [];
    var coil2 = [];

    var dtheta = 2 * Math.PI / numSegments;

    var z1 = -separation / 2;
    var z2 =  separation / 2;

    for (var i = 0; i < numSegments; i++) {

        var theta = dtheta * i;

        var cos = R * Math.cos(theta);
        var sin = R * Math.sin(theta);

        coil1.push([cos, sin, z1]);
        coil2.push([cos, sin, z2]);

    }

    // Segment vectors (dl = next - current) 与中点
    var segmentVectors = [];
    var segmentMidpoints = [];

    for (var i = 0; i < numSegments; i++) {

        var j = (i + 1) % numSegments;

        // coil 1
        segmentVectors.push([
            coil1[j][0] - coil1[i][0],
            coil1[j][1] - coil1[i][1],
            coil1[j][2] - coil1[i][2]
        ]);

        segmentMidpoints.push([
            (coil1[j][0] + coil1[i][0]) / 2,
            (coil1[j][1] + coil1[i][1]) / 2,
            (coil1[j][2] + coil1[i][2]) / 2
        ]);

        // coil 2
        segmentVectors.push([
            coil2[j][0] - coil2[i][0],
            coil2[j][1] - coil2[i][1],
            coil2[j][2] - coil2[i][2]
        ]);

        segmentMidpoints.push([
            (coil2[j][0] + coil2[i][0]) / 2,
            (coil2[j][1] + coil2[i][1]) / 2,
            (coil2[j][2] + coil2[i][2]) / 2
        ]);

    }

    return {
        coil1: coil1,
        coil2: coil2,
        segmentVectors: segmentVectors,
        segmentMidpoints: segmentMidpoints
    };

}


// ============================================================
// 3. Magnetic field using Biot-Savart law
//   dB = mu0/(4*pi) * I * dl x r / |r|^3
// ============================================================

function magneticField(position, segmentVectors, segmentMidpoints, current, turns) {

    var bx = 0;
    var by = 0;
    var bz = 0;

    for (var i = 0; i < segmentVectors.length; i++) {

        var sx = segmentMidpoints[i][0];
        var sy = segmentMidpoints[i][1];
        var sz = segmentMidpoints[i][2];

        var rx = position[0] - sx;
        var ry = position[1] - sy;
        var rz = position[2] - sz;

        var distance = Math.sqrt(rx * rx + ry * ry + rz * rz);

        // Avoid division by zero (与 numpy np.maximum(distance, 1e-12) 一致)
        if (distance < 1e-12) {
            distance = 1e-12;
        }

        var invDist3 = 1 / (distance * distance * distance);

        var dx = segmentVectors[i][0];
        var dy = segmentVectors[i][1];
        var dz = segmentVectors[i][2];

        // cross(dl, r)
        var cx = dy * rz - dz * ry;
        var cy = dz * rx - dx * rz;
        var cz = dx * ry - dy * rx;

        bx += cx * invDist3;
        by += cy * invDist3;
        bz += cz * invDist3;

    }

    var factor = MU0 / (4 * Math.PI) * current * turns;

    return [
        factor * bx,
        factor * by,
        factor * bz
    ];

}


// ============================================================
// 4. Theoretical Helmholtz center field
// ============================================================

function theoreticalCenterField(R, turns, current) {

    return (
        Math.pow(4 / 5, 1.5)
        * MU0
        * turns
        * current
        / R
    );

}


// ============================================================
// 5. Lorentz acceleration
//   a = q/m * (v x B)
// ============================================================

function acceleration(position, velocity, charge, mass, segmentVectors, segmentMidpoints, current, turns) {

    var B = magneticField(
        position,
        segmentVectors,
        segmentMidpoints,
        current,
        turns
    );

    var vx = velocity[0];
    var vy = velocity[1];
    var vz = velocity[2];

    // cross(velocity, B)
    var cx = vy * B[2] - vz * B[1];
    var cy = vz * B[0] - vx * B[2];
    var cz = vx * B[1] - vy * B[0];

    var factor = charge / mass;

    return [
        factor * cx,
        factor * cy,
        factor * cz
    ];

}


// ============================================================
// 6. RK4 integration
//   state = [x, y, z, vx, vy, vz]
// ============================================================

function rk4Step(state, dt, charge, mass, segmentVectors, segmentMidpoints, current, turns) {

    function derivative(s) {

        var position = [s[0], s[1], s[2]];
        var velocity = [s[3], s[4], s[5]];

        var a = acceleration(
            position,
            velocity,
            charge,
            mass,
            segmentVectors,
            segmentMidpoints,
            current,
            turns
        );

        return [
            velocity[0],
            velocity[1],
            velocity[2],
            a[0],
            a[1],
            a[2]
        ];

    }

    var k1 = derivative(state);

    var s2 = [
        state[0] + 0.5 * dt * k1[0],
        state[1] + 0.5 * dt * k1[1],
        state[2] + 0.5 * dt * k1[2],
        state[3] + 0.5 * dt * k1[3],
        state[4] + 0.5 * dt * k1[4],
        state[5] + 0.5 * dt * k1[5]
    ];
    var k2 = derivative(s2);

    var s3 = [
        state[0] + 0.5 * dt * k2[0],
        state[1] + 0.5 * dt * k2[1],
        state[2] + 0.5 * dt * k2[2],
        state[3] + 0.5 * dt * k2[3],
        state[4] + 0.5 * dt * k2[4],
        state[5] + 0.5 * dt * k2[5]
    ];
    var k3 = derivative(s3);

    var s4 = [
        state[0] + dt * k3[0],
        state[1] + dt * k3[1],
        state[2] + dt * k3[2],
        state[3] + dt * k3[3],
        state[4] + dt * k3[4],
        state[5] + dt * k3[5]
    ];
    var k4 = derivative(s4);

    var newState = [];

    for (var i = 0; i < 6; i++) {

        newState.push(
            state[i]
            + dt / 6
            * (
                k1[i]
                + 2 * k2[i]
                + 2 * k3[i]
                + k4[i]
            )
        );

    }

    return newState;

}


// ============================================================
// 7. Main simulation function（对外入口）
// ============================================================

function runSimulationJS(params) {

    try {

        // ----------------------------------------------------
        // Read parameters
        // ----------------------------------------------------

        var charge = Number(params["q"]);
        var mass = Number(params["m"]);

        var x0 = Number(params["x0"]);
        var y0 = Number(params["y0"]);
        var z0 = Number(params["z0"]);

        var vx0 = Number(params["vx0"]);
        var vy0 = Number(params["vy0"]);
        var vz0 = Number(params["vz0"]);

        var R = Number(params["R"]);
        var turns = parseInt(params["N"], 10);
        var current = Number(params["I"]);

        var numPeriods = Number(params["num_periods"]);
        var stepsPerPeriod = parseInt(params["steps_per_period"], 10);

        // 内部精度：线圈离散段数（与后端一致）
        var numSegments = 200;

        // ----------------------------------------------------
        // Basic validation
        // ----------------------------------------------------

        if (!(mass > 0)) {
            throw new Error("Mass must be greater than zero.");
        }
        if (!(R > 0)) {
            throw new Error("Coil radius must be greater than zero.");
        }
        if (!(turns > 0)) {
            throw new Error("Number of turns must be greater than zero.");
        }
        if (current === 0) {
            throw new Error("Current cannot be zero.");
        }
        if (!(numPeriods > 0)) {
            throw new Error("Number of periods must be greater than zero.");
        }
        if (stepsPerPeriod < 20) {
            throw new Error("steps_per_period should be at least 20.");
        }

        // ----------------------------------------------------
        // Helmholtz condition: separation = R
        // ----------------------------------------------------

        var separation = R;

        var coils = buildCoils(R, separation, numSegments);

        var coil1 = coils.coil1;
        var coil2 = coils.coil2;
        var segmentVectors = coils.segmentVectors;
        var segmentMidpoints = coils.segmentMidpoints;

        // ----------------------------------------------------
        // Magnetic field at center
        // ----------------------------------------------------

        var BcenterVector = magneticField(
            [0, 0, 0],
            segmentVectors,
            segmentMidpoints,
            current,
            turns
        );

        var Bcenter = Math.sqrt(
            BcenterVector[0] * BcenterVector[0]
            + BcenterVector[1] * BcenterVector[1]
            + BcenterVector[2] * BcenterVector[2]
        );

        var Btheory = theoreticalCenterField(R, turns, current);

        var fieldError = (
            Math.abs(Bcenter - Btheory)
            / Btheory
            * 100
        );

        // ----------------------------------------------------
        // Initial velocity & energy
        // ----------------------------------------------------

        var speed0 = Math.sqrt(vx0 * vx0 + vy0 * vy0 + vz0 * vz0);

        var initialEnergy = 0.5 * mass * speed0 * speed0;

        // ----------------------------------------------------
        // Cyclotron frequency
        // ----------------------------------------------------

        if (!(Bcenter > 0)) {
            throw new Error("Magnetic field is zero.");
        }

        var omega = Math.abs(charge) * Bcenter / mass;

        var cyclotronFrequency = omega / (2 * Math.PI);
        var cyclotronPeriod = 2 * Math.PI / omega;

        // ----------------------------------------------------
        // Automatic time step
        // ----------------------------------------------------

        var dt = cyclotronPeriod / stepsPerPeriod;
        var totalTime = numPeriods * cyclotronPeriod;
        var numSteps = Math.ceil(totalTime / dt);

        // ----------------------------------------------------
        // Initial state
        // ----------------------------------------------------

        var state = [x0, y0, z0, vx0, vy0, vz0];

        // ----------------------------------------------------
        // Storage
        // ----------------------------------------------------

        var positions = [];
        var velocities = [];
        var times = [];
        var energies = [];

        positions.push([state[0], state[1], state[2]]);
        velocities.push([state[3], state[4], state[5]]);
        times.push(0);
        energies.push(initialEnergy);

        // ----------------------------------------------------
        // Time integration
        // ----------------------------------------------------

        for (var i = 0; i < numSteps; i++) {

            state = rk4Step(
                state,
                dt,
                charge,
                mass,
                segmentVectors,
                segmentMidpoints,
                current,
                turns
            );

            positions.push([state[0], state[1], state[2]]);
            velocities.push([state[3], state[4], state[5]]);

            times.push(times[i] + dt);

            var speed = Math.sqrt(
                state[3] * state[3]
                + state[4] * state[4]
                + state[5] * state[5]
            );

            energies.push(0.5 * mass * speed * speed);

        }

        // ----------------------------------------------------
        // Energy conservation error
        // ----------------------------------------------------

        var maxEnergyError = 0;

        if (initialEnergy > 0) {

            var maxAbs = 0;

            for (var i = 0; i < energies.length; i++) {

                var diff = Math.abs(energies[i] - initialEnergy);

                if (diff > maxAbs) {
                    maxAbs = diff;
                }

            }

            maxEnergyError = maxAbs / initialEnergy * 100;

        }

        // ----------------------------------------------------
        // Trajectory range
        // ----------------------------------------------------

        var xRange = rangeOf(positions, 0);
        var yRange = rangeOf(positions, 1);
        var zRange = rangeOf(positions, 2);

        // ----------------------------------------------------
        // Return results（字段与后端完全一致）
        // ----------------------------------------------------

        return {
            success: true,
            data: {
                positions: positions,
                times: times,

                coil1: coil1,
                coil2: coil2,

                B_center: Bcenter,
                B_theory: Btheory,
                field_error_percent: fieldError,

                cyclotron_frequency: cyclotronFrequency,
                cyclotron_period: cyclotronPeriod,

                dt: dt,

                total_time: times[times.length - 1],

                num_steps: numSteps,

                energy_error_percent: maxEnergyError,

                x_range: xRange,
                y_range: yRange,
                z_range: zRange
            }
        };

    }

    catch (e) {

        return {
            success: false,
            error: (e && e.message) ? e.message : String(e)
        };

    }

}


// ============================================================
// Helper: 取某维度的 [min, max]
// ============================================================

function rangeOf(points, axis) {

    if (!points || points.length === 0) {
        return [0, 0];
    }

    var min = points[0][axis];
    var max = points[0][axis];

    for (var i = 1; i < points.length; i++) {

        var v = points[i][axis];

        if (v < min) min = v;
        if (v > max) max = v;

    }

    return [min, max];

}


// ============================================================
// 暴露给浏览器：普通脚本，定义全局函数
// ============================================================

if (typeof window !== "undefined") {
    window.runSimulationJS = runSimulationJS;
}


// ============================================================
// 支持 Node 端 require（仅用于离线验证，不影响浏览器）
// ============================================================

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        runSimulationJS: runSimulationJS,
        buildCoils: buildCoils,
        magneticField: magneticField,
        theoreticalCenterField: theoreticalCenterField
    };
}
