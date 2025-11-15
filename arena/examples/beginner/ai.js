/* -----------------------------------------------------------------
   CONFIGURATION – Tweak for your robot
   ----------------------------------------------------------------- */
const IMAGE_SIZE = 96;          // 96×96 = fast + good enough
const FPS = 12;          // prediction rate
const RECORD_FPS = 8;           // recording rate (lower = less RAM)
const BUFFER_SIZE = 400;         // max (image, joints) pairs
const BATCH_SIZE = 16;
const EPOCHS = 4;
const LEARNING_RATE = 8e-4;
const CONTINUOUS_LEARN = false;     // set true to keep training while running

/* -----------------------------------------------------------------
   GLOBAL STATE
   ----------------------------------------------------------------- */
let model = null;
let running = false;
let recording = false;
let lastBlob = null;
let dataset = [];
let captureInt = null;
let predictInt = null;
let isTraining = false;

/* -----------------------------------------------------------------
   UI
   ----------------------------------------------------------------- */
function buildUI() {
    const panel = document.getElementById('ai-panel') || createPanel();
    panel.innerHTML = `
        <h3>Real-Time Imitation AI</h3>
        <button id="ai-record">Record</button>
        <button id="ai-train" disabled>Train</button>
        <button id="ai-run"   disabled>Run</button>
        <button id="ai-stop"  disabled>Stop</button>
        <button id="ai-clear" style="margin-left:4px;font-size:9px;">Clear</button>
        <div style="margin-top:6px; font-size:10px; color:#0f0">
            Status: <span id="ai-stat">idle</span> | 
            Samples: <span id="ai-samples">0</span> | 
            Loss: <span id="ai-loss">-</span>
        </div>
    `;

    document.getElementById('ai-record').onclick = toggleRecord;
    document.getElementById('ai-train').onclick = train;
    document.getElementById('ai-run').onclick = startPredict;
    document.getElementById('ai-stop').onclick = stopAll;
    document.getElementById('ai-clear').onclick = clearDataset;
}
function createPanel() {
    const div = document.createElement('div');
    div.id = 'ai-panel';
    document.body.appendChild(div);
    return div;
}
function setStatus(txt) {
    const el = document.getElementById('ai-stat');
    if (el) el.textContent = txt;
}
function setSamples(n) {
    const el = document.getElementById('ai-samples');
    if (el) el.textContent = n;
}
function setLoss(l) {
    const el = document.getElementById('ai-loss');
    if (el) el.textContent = l >= 0 ? l.toFixed(4) : '-';
}

/* -----------------------------------------------------------------
   Wait for TF.js
   ----------------------------------------------------------------- */
async function waitForTF() {
    const maxWait = 10000; // 10 seconds max
    const start = Date.now();

    while (Date.now() - start < maxWait) {
        if (typeof tf !== 'undefined' && tf.layers) {
            // Check if we have any optimizer
            if (tf.optimizers && typeof tf.optimizers.adam === 'function') {
                console.log('[AI] ADAM optimizer ready');
                return 'adam';
            }
            if (tf.train && typeof tf.train.sgd === 'function') {
                console.log('[AI] Falling back to SGD optimizer');
                return 'sgd';
            }
        }
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('TF.js failed to load after 10s');
}

/* -----------------------------------------------------------------
   CAMERA → Tensor (grayscale, [-1,1])
   ----------------------------------------------------------------- */
async function blobToTensor(blob) {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = IMAGE_SIZE;
    canvas.height = IMAGE_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, IMAGE_SIZE, IMAGE_SIZE);

    const imgData = ctx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
    const pixels = new Float32Array(IMAGE_SIZE * IMAGE_SIZE);
    for (let i = 0; i < imgData.data.length; i += 4) {
        const gray = imgData.data[i] * 0.299 + imgData.data[i + 1] * 0.587 + imgData.data[i + 2] * 0.114;
        pixels[i / 4] = gray / 127.5 - 1;
    }
    return tf.tidy(() => tf.tensor4d(pixels, [1, IMAGE_SIZE, IMAGE_SIZE, 1]));
}

/* -----------------------------------------------------------------
   JOINTS → Tensor (normalized [-1,1])
   ----------------------------------------------------------------- */
function jointsToTensor(jointsObj) {
    const arr = window.availableJoints.map(j => {
        const v = jointsObj[j.name] ?? j.value;
        return 2 * ((v - j.min) / (j.max - j.min)) - 1;
    });
    return tf.tensor2d([arr]);
}

/* -----------------------------------------------------------------
   RECORDING
   ----------------------------------------------------------------- */
async function captureSample() {
    if (!lastBlob) return;
    const img = await blobToTensor(lastBlob);
    const joints = jointsToTensor(window.currentJoints || {});
    dataset.push({ img, joints });
    if (dataset.length > BUFFER_SIZE) {
        const old = dataset.shift();
        old.img.dispose();
        old.joints.dispose();
    }
    setSamples(dataset.length);
}
function toggleRecord() {
    recording = !recording;
    const btn = document.getElementById('ai-record');
    btn.textContent = recording ? 'Stop Rec' : 'Record';
    btn.classList.toggle('active', recording);
    document.getElementById('ai-train').disabled = !recording && dataset.length === 0;
    if (recording) startCaptureLoop();
    else stopCaptureLoop();
}
function startCaptureLoop() {
    stopCaptureLoop();
    captureInt = setInterval(captureSample, 1000 / RECORD_FPS);
}
function stopCaptureLoop() {
    if (captureInt) clearInterval(captureInt);
    captureInt = null;
}
function clearDataset() {
    dataset.forEach(d => { d.img.dispose(); d.joints.dispose(); });
    dataset = [];
    setSamples(0);
    setLoss(-1);
}

/* -----------------------------------------------------------------
   MODEL – CNN
   ----------------------------------------------------------------- */
async function createModel(inputShape, outputDim) {
    const optimizerType = await waitForTF();

    const m = tf.sequential();
    m.add(tf.layers.conv2d({
        inputShape,
        filters: 16, kernelSize: 5, strides: 2, activation: 'relu'
    }));
    m.add(tf.layers.conv2d({ filters: 32, kernelSize: 3, strides: 2, activation: 'relu' }));
    m.add(tf.layers.conv2d({ filters: 64, kernelSize: 3, strides: 2, activation: 'relu' }));
    m.add(tf.layers.flatten());
    m.add(tf.layers.dropout({ rate: 0.3 }));
    m.add(tf.layers.dense({ units: 128, activation: 'relu' }));
    m.add(tf.layers.dense({ units: outputDim, activation: 'tanh' }));

    const optimizer = optimizerType === 'adam'
        ? tf.optimizers.adam(LEARNING_RATE)
        : tf.train.sgd(LEARNING_RATE);

    m.compile({ optimizer, loss: 'meanSquaredError' });
    return m;
}

/* -----------------------------------------------------------------
   TRAINING
   ----------------------------------------------------------------- */
async function train() {
    if (dataset.length < 10) {
        alert('Record at least 10 samples first');
        return;
    }
    if (isTraining) return;
    isTraining = true;
    setStatus('building model...');

    const inputShape = [IMAGE_SIZE, IMAGE_SIZE, 1];
    const outputDim = window.availableJoints.length;

    if (model) model.dispose();

    try {
        model = await createModel(inputShape, outputDim);
    } catch (err) {
        console.error(err);
        setStatus('TF.js load failed');
        isTraining = false;
        return;
    }

    const xs = tf.concat(dataset.map(d => d.img), 0);
    const ys = tf.concat(dataset.map(d => d.joints), 0);

    setStatus('training...');
    try {
        await model.fit(xs, ys, {
            batchSize: Math.min(BATCH_SIZE, dataset.length),
            epochs: EPOCHS,
            shuffle: true,
            callbacks: {
                onEpochEnd: (e, logs) => setStatus(`epoch ${e + 1}/${EPOCHS} loss ${logs.loss.toFixed(4)}`)
            }
        });
    } catch (err) {
        console.error('Fit failed:', err);
        setStatus('training error');
        isTraining = false;
        return;
    }

    xs.dispose(); ys.dispose();
    isTraining = false;
    setStatus('trained – click Run');
    document.getElementById('ai-run').disabled = false;
}
/* -----------------------------------------------------------------
   PREDICTION
   ----------------------------------------------------------------- */
async function predictStep() {
    if (!lastBlob || !model) return;

    const img = await blobToTensor(lastBlob);
    const predNorm = model.predict(img);
    const arr = await predNorm.array();
    img.dispose();
    predNorm.dispose();

    window.availableJoints.forEach((j, i) => {
        const norm = arr[0][i];
        const target = j.min + (norm + 1) / 2 * (j.max - j.min);
        const clamped = Math.max(j.min, Math.min(j.max, target));
        window.sendJoint(j.name, clamped, 0.06);
    });

    // Continuous learning
    if (CONTINUOUS_LEARN && recording && dataset.length > 0) {
        const last = dataset[dataset.length - 1];
        const x = last.img;
        const y = jointsToTensor(window.currentJoints);
        await model.fit(x, y, { epochs: 1, batchSize: 1 });
        y.dispose();
    }
}

function startPredict() {
    if (running) return;
    running = true;
    document.getElementById('ai-run').disabled = true;
    document.getElementById('ai-stop').disabled = false;
    setStatus('predicting');

    predictInt = setInterval(() => {
        predictStep().catch(console.error);
    }, 1000 / FPS);
}
function stopPredict() {
    if (predictInt) clearInterval(predictInt);
    predictInt = null;
}

/* -----------------------------------------------------------------
   GLOBAL CONTROL
   ----------------------------------------------------------------- */
function stopAll() {
    running = false;
    recording = false;
    stopCaptureLoop();
    stopPredict();

    const recBtn = document.getElementById('ai-record');
    recBtn.textContent = 'Record';
    recBtn.classList.remove('active');

    document.getElementById('ai-train').disabled = dataset.length === 0;
    document.getElementById('ai-run').disabled = true;
    document.getElementById('ai-stop').disabled = true;
    setStatus('stopped');
}

/* -----------------------------------------------------------------
   HOOKS
   ----------------------------------------------------------------- */
window.currentJoints = {};

window.addEventListener('message', e => {
    if (e.data?.type === 'JOINTS_UPDATE') {
        Object.assign(window.currentJoints, e.data.updates);
    }
    if (e.data?.type === 'CAMERA_FRAME' && e.data?.buffer) {
        const blob = new Blob([e.data.buffer], { type: 'image/webp' });
        lastBlob = blob;
    }
});

window.addEventListener('ai-joints-ready', () => {
    console.log('[AI] Joints ready – building UI');
    buildUI();
    setStatus('ready');
});

/* -----------------------------------------------------------------
   INIT
   ----------------------------------------------------------------- */
waitForTF().then(() => console.log('[AI] Imitation learning loaded'));
