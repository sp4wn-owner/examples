/* --------------------------------------------------------------- */
/* ai-controller.js – MOVE ALL JOINTS + AUTO-START                 */
/* --------------------------------------------------------------- */
(() => {
    let timer = null;
    let running = false;

    // === Build UI ===
    function buildUi() {
        const panel = document.getElementById('ai-panel');
        if (!panel) return false;

        panel.innerHTML = `
            <h3>AI: All Joints</h3>
            <button id="ai-start">Start</button>
            <button id="ai-stop" disabled>Stop</button>
            <div style="margin-top:6px; font-size:10px; color:#0f0;">
                Moving <span id="joint-count">0</span> joints
            </div>
        `;

        document.getElementById('ai-start').onclick = startAi;
        document.getElementById('ai-stop').onclick = stopAi;

        updateJointCount();
        return true;
    }

    function updateJointCount() {
        const count = (window.availableJoints || []).length;
        const el = document.getElementById('joint-count');
        if (el) el.textContent = count;
    }

    // === Wrap sendJoint with LOG ===
    const orig = window.sendJoint;
    window.sendJoint = function (j, v) {
        console.log(`[AI] ${j} → ${v}`);
        orig(j, v);
    };

    // === MAIN AI: Move ALL joints in wave pattern ===
    function startAi() {
        if (running) return;
        stopAi();

        const joints = window.availableJoints || [];
        if (!joints.length) {
            console.warn('[AI] No joints loaded');
            return;
        }

        const status = document.getElementById('robot-status');
        if (status) status.textContent = `AI: Moving ${joints.length} joints`;

        document.getElementById('ai-start').disabled = true;
        document.getElementById('ai-stop').disabled = false;
        running = true;

        let phase = 0;
        const loop = () => {
            if (!running) return;

            phase += 0.1;
            joints.forEach((joint, i) => {
                const offset = i * 0.5;
                const t = phase + offset;
                const range = joint.max - joint.min;
                const value = joint.min + range * (Math.sin(t) * 0.5 + 0.5);
                window.sendJoint(joint.name, value, 0.1);
            });

            timer = setTimeout(loop, 100);
        };

        console.log(`[AI] Starting wave on ${joints.length} joints`);
        loop();
    }

    function stopAi() {
        if (timer) clearTimeout(timer);
        timer = null;
        running = false;

        const status = document.getElementById('robot-status');
        if (status) status.textContent = 'AI: Idle';

        const startBtn = document.getElementById('ai-start');
        const stopBtn = document.getElementById('ai-stop');
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
    }

    // === AUTO-START ===
    function autoStart() {
        if (window.availableJoints?.length) {
            console.log('[AI] Auto-starting all joints');
            buildUi();
            //startAi();
        } else {
            setTimeout(autoStart, 500);
        }
    }

    // === INIT ===
    window.addEventListener('ai-joints-ready', () => {
        console.log('[AI] Joints ready');
        updateJointCount();
        autoStart();
    });

    window.stopRobotAi = stopAi;
    console.log('[AI] All-joints AI loaded');
})();