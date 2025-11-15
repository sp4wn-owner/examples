/* --------------------------------------------------------------- */
/* controller.js – Joint sliders + global sendJoint + availableJoints */
/* --------------------------------------------------------------- */
const iframe = document.getElementById('arena');
const TARGET_ORIGIN = 'http://localhost:3000';  // Must match iframe src
const activeDrag = new Set();
window.availableJoints = [];

/* --------------------------------------------------------------- */
/* SEND JOINT VALUE (GLOBAL)                                       */
/* --------------------------------------------------------------- */
window.sendJoint = function (jointName, value, duration = 0.3) {
    iframe.contentWindow.postMessage({
        forwardEvent: {
            eventName: 'ai-set-joint',
            detail: { joint: jointName, value, duration }
        }
    }, TARGET_ORIGIN);
};

/* --------------------------------------------------------------- */
/* BUILD SLIDERS                                                   */
/* --------------------------------------------------------------- */
function buildAllJointSliders() {
    const panel = document.getElementById('joint-panel');
    if (!panel) return;
    panel.innerHTML = '';

    window.availableJoints.forEach(joint => {
        const div = document.createElement('div');
        div.className = 'joint-control';
        div.innerHTML = `
            <div class="joint-label">${joint.name.slice(0, 8).toUpperCase()}</div>
            <input type="range" class="joint-slider" min="${joint.min}" max="${joint.max}" step="0.01" value="${joint.value}" data-joint="${joint.name}">
            <div class="joint-value">${joint.value.toFixed(2)}</div>
        `;
        const slider = div.querySelector('.joint-slider');
        const valueEl = div.querySelector('.joint-value');

        slider.addEventListener('input', () => {
            const name = slider.dataset.joint;
            activeDrag.add(name);
            const val = parseFloat(slider.value);
            valueEl.textContent = val.toFixed(2);
            window.sendJoint(name, val);
        });
        slider.addEventListener('change', () => activeDrag.delete(slider.dataset.joint));
        panel.appendChild(div);
    });
}

/* --------------------------------------------------------------- */
/* CAMERA FEED – Pull Model                                        */
/* --------------------------------------------------------------- */
const cameraImg = document.getElementById('camera-feed');
let lastFrameUrl = null;
let cameraInterval = null;

/** Request one frame */
window.requestCameraFrame = function (quality = 0.5) {
    iframe.contentWindow.postMessage({
        type: 'REQUEST_CAMERA_FRAME',
        quality
    }, TARGET_ORIGIN);
};

/** Start feed */
window.startCameraFeed = function (fps = 2) {
    window.stopCameraFeed();
    const interval = 1000 / fps;
    cameraInterval = setInterval(() => window.requestCameraFrame(0.6), interval);
    console.log(`[CAMERA] Feed started @ ${fps} FPS`);
};

/** Stop feed */
window.stopCameraFeed = function () {
    if (cameraInterval) {
        clearInterval(cameraInterval);
        cameraInterval = null;
        console.log('[CAMERA] Feed stopped');
    }
};

/* --------------------------------------------------------------- */
/* CENTRAL MESSAGE HANDLER                                         */
/* --------------------------------------------------------------- */
window.addEventListener('message', e => {
    if (e.origin !== TARGET_ORIGIN) return;

    const d = e.data;

    // JOINTS LIST
    if (d?.type === 'JOINTS_LIST') {
        window.availableJoints = d.joints;
        console.log('%c[JOINTS LOADED]', 'color:#0f0;font-weight:bold');
        buildAllJointSliders();
        window.dispatchEvent(new CustomEvent('ai-joints-ready'));
    }

    // JOINTS UPDATE
    if (d?.type === 'JOINTS_UPDATE') {
        Object.entries(d.updates).forEach(([name, value]) => {
            if (activeDrag.has(name)) return;
            const slider = document.querySelector(`input[data-joint="${name}"]`);
            if (!slider) return;
            const diff = Math.abs(parseFloat(slider.value) - value);
            if (diff > 0.002) {
                slider.value = value;
                const valEl = slider.parentElement.querySelector('.joint-value');
                if (valEl) valEl.textContent = value.toFixed(2);
            }
        });
    }

    // CAMERA FRAME
    if (d?.type === 'CAMERA_FRAME') {
        // Revoke previous
        if (lastFrameUrl) {
            URL.revokeObjectURL(lastFrameUrl);
        }

        if (d.buffer) {
            const blob = new Blob([d.buffer], { type: 'image/webp' });
            const url = URL.createObjectURL(blob);  // ← Created in PARENT origin
            cameraImg.src = url;
            lastFrameUrl = url;
        } else {
            console.warn('[CAMERA] Empty buffer');
        }
    }

    // AI CONTROL STATE FROM IFRAME
    if (d?.type === 'AI_CONTROL_STATE') {
        const enabled = d.enabled;
        window.aiControlEnabled = enabled;
        const btn = document.getElementById('ai-button');
        if (btn) {
            btn.classList.toggle('active', enabled);
            btn.title = enabled ? 'AI: ON' : 'AI: OFF';
        }
        if (enabled) {
            window.startCameraFeed(2);
        } else {
            window.stopCameraFeed();
        }
    }
});

/* --------------------------------------------------------------- */
/* AI BUTTON – Toggle via iframe                                   */
/* --------------------------------------------------------------- */
document.getElementById('ai-button')?.addEventListener('click', () => {
    iframe.contentWindow.postMessage({
        type: 'TOGGLE_AI_CONTROL'
    }, TARGET_ORIGIN);
});

/* --------------------------------------------------------------- */
/* AUTO-START ON JOINTS READY                                      */
/* --------------------------------------------------------------- */
window.addEventListener('ai-joints-ready', () => {
    console.log('[AI] Joints ready – waiting for AI toggle');
});