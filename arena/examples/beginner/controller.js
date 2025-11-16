const iframe = document.getElementById('arena');
const TARGET_ORIGIN = 'https://arena.sp4wn.com';
window.availableJoints = [];
let autoStart = true;

window.sendJoint = function (jointName, value, duration = 0.3) {
    iframe.contentWindow.postMessage({
        forwardEvent: {
            eventName: 'ai-set-joint',
            detail: { joint: jointName, value, duration }
        }
    }, TARGET_ORIGIN);
};

let lastFrameUrl = null;
let isLoopActive = false;
let lastTime = 0;
let fps = 20;
let frameInterval = 1000 / fps;

const previewImg = document.createElement('img');
previewImg.id = 'ai-camera-preview';
Object.assign(previewImg.style, {
    position: 'fixed',
    bottom: '20px',
    left: '0',
    width: '240px',
    height: '135px',
    border: '3px solid #4CAF50',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    zIndex: '9999',
    objectFit: 'contain',
    background: '#111',
    display: 'none'
});
document.body.appendChild(previewImg);

const requestFrame = (quality = 0.6) => {
    iframe.contentWindow.postMessage({
        type: 'REQUEST_CAMERA_FRAME',
        quality
    }, TARGET_ORIGIN);
};

/** Internal RAF loop – only sends postMessage */
const loop = (now) => {
    if (!isLoopActive) return;

    if (now - lastTime >= frameInterval) {
        requestFrame();
        lastTime = now - (now - lastTime) % frameInterval;
    }

    requestAnimationFrame(loop);
};

const startCameraFeed = (targetFps = 20) => {
    if (isLoopActive) return;
    fps = targetFps;
    frameInterval = 1000 / fps;
    isLoopActive = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
    previewImg.style.display = 'block';
    console.log(`[CAMERA] Feed started @ ~${fps} FPS (preview visible)`);
};

const stopCameraFeed = () => {
    isLoopActive = false;
    previewImg.style.display = 'none';
    console.log('[CAMERA] Feed stopped');
};

window.addEventListener('message', e => {
    const d = e.data;

    // JOINTS LIST
    if (d?.type === 'JOINTS_LIST') {
        window.availableJoints = d.joints;
        console.log('%c[JOINTS LOADED]', 'color:#0f0;font-weight:bold');
        if (autoStart) {
            startCameraFeed();
            buildUI();
        }
    }

    // CAMERA FRAME
    if (d?.type === 'CAMERA_FRAME') {
        if (d.error) {
            previewImg.src = '';
            previewImg.alt = 'Camera: Unauthorized';
            console.warn('[CAMERA] Access denied:', d.error);
            return;
        }

        if (d.buffer) {
            const blob = new Blob([d.buffer], { type: 'image/webp' });
            const url = URL.createObjectURL(blob);
            previewImg.src = url;

            window.latestCameraFrame = url;

            if (lastFrameUrl) URL.revokeObjectURL(lastFrameUrl);
            lastFrameUrl = url;
        }
    }
});