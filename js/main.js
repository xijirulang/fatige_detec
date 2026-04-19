import { getDomElements } from './dom.js';
import { createUI } from './ui.js';
import { createStorage } from './storage.js';
import { createDetector } from './detector.js';
import { createCameraController } from './camera.js';

// 全局 DOM 引用。
const dom = getDomElements();
// UI 控制器。
const ui = createUI(dom);
// 数据存储与导出控制器。
const storage = createStorage();
// 检测算法控制器。
const detector = createDetector({ dom, ui, storage });
// 摄像头与模型控制器。
const cameraController = createCameraController({
    videoElement: dom.videoElement,
    onResults: detector.handleResults
});

// 当前是否处于检测运行状态。
let isRunning = false;
// 浏览器屏幕常亮锁对象。
let wakeLock = null;

// 请求屏幕常亮，避免长时间检测时熄屏。
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('屏幕防休眠已激活');
        }
    } catch (err) {
        console.warn(`屏幕常亮请求失败: ${err.name}, ${err.message}`);
    }
}

// 释放屏幕常亮锁。
function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release().then(() => { wakeLock = null; });
    }
}

// 启动一次完整检测流程。
async function startDetection() {
    await requestWakeLock();

    storage.startSession();
    detector.resetSessionRuntime();
    detector.startCalibration();

    ui.setStartingState();

    if (!cameraController.isInitialized()) {
        ui.showModelLoadingLog();
    }

    await cameraController.start();
    isRunning = true;
}

// 停止检测并回收界面与资源状态。
async function stopDetection() {
    await cameraController.stop();
    releaseWakeLock();

    const canvasCtx = dom.canvasElement.getContext('2d');
    canvasCtx.clearRect(0, 0, dom.canvasElement.width, dom.canvasElement.height);

    storage.markLoggingEnd();
    ui.resetMetrics();
    ui.setStoppedState();
    isRunning = false;
}

// 绑定启停按钮行为。
dom.toggleBtn.addEventListener('click', async () => {
    if (!isRunning) {
        try {
            await startDetection();
        } catch (error) {
            ui.triggerAlert('启动摄像头失败，请重试。', 'critical');
            ui.setStartFailedState();
        }
        return;
    }

    await stopDetection();
});

// 绑定导出按钮行为。
dom.exportBtn.addEventListener('click', () => {
    if (!storage.hasData()) {
        ui.triggerAlert('目前没有记录到任何数据可供导出。', 'info');
        return;
    }

    storage.exportAll();
    ui.triggerAlert('成功导出！分为 [疲劳事件] 与 [60秒PERCLOS+BlinkRate] 两个文件。', 'info');
});
