import {
    EAR_RATIO_THRESHOLD,
    MAR_THRESHOLD,
    CLOSED_EYES_TIME,
    HEAD_MOVE_THRESHOLD,
    EYE_ALERT_COOLDOWN_MS,
    YAWN_ALERT_COOLDOWN_MS,
    YAWN_MIN_DURATION_MS,
    HEAD_MOVE_ALERT_COOLDOWN_MS,
    CALIBRATION_DURATION_MS,
    CALIBRATION_MIN_SAMPLES,
    PERCLOS_EPOCH_MS,
    BLINK_RATE_WINDOW_MS,
    MIN_BLINK_DURATION_MS,
    EAR_SMOOTH_WINDOW_SIZE,
    MAR_SMOOTH_WINDOW_SIZE,
    RIGHT_EYE_INDICES,
    LEFT_EYE_INDICES
} from './config.js';
import { calculateEAR, calculateMAR } from './utils.js';

// 核心检测器：处理模型输出并驱动告警、UI 与存储。
export function createDetector({ dom, ui, storage }) {
    // 主绘图上下文。
    const canvasCtx = dom.canvasElement.getContext('2d');

    // 校准相关状态。
    let isCalibrating = false;
    let calibrationStartTime = 0;
    let calibrationEARValues = [];
    let baselineEAR = 0;
    let currentEarThreshold = 0.2;

    // PERCLOS 周期累计状态。
    let epochStartTime = 0;
    let perclosSamples = [];

    // 事件检测计时状态。
    let eyesClosedStartTime = 0;
    let isEyesClosed = false;
    let lastEyeAlertTime = 0;
    let lastYawnTime = 0;
    let yawnOpenStartTime = 0;
    let yawnTriggeredInCurrentOpen = false;
    let lastHeadMoveTime = 0;
    let lastNosePosition = null;
    let blinkTimestamps = [];
    let earSmoothWindow = [];
    let marSmoothWindow = [];
    let earSmoothWindowSize = EAR_SMOOTH_WINDOW_SIZE;
    let marSmoothWindowSize = MAR_SMOOTH_WINDOW_SIZE;

    // 对窗口参数做边界收敛，避免非法配置。
    function clampWindowSize(value) {
        return Math.min(30, Math.max(1, Math.round(value)));
    }

    // 将新样本加入窗口并返回当前窗口平均值。
    function getMovingAverage(window, value, maxSize) {
        window.push(value);
        if (window.length > maxSize) {
            window.shift();
        }
        const sum = window.reduce((acc, item) => acc + item, 0);
        return sum / window.length;
    }

    // 仅保留统计窗口内的眨眼时间戳。
    function pruneBlinkTimestamps(now) {
        blinkTimestamps = blinkTimestamps.filter((t) => (now - t) <= BLINK_RATE_WINDOW_MS);
    }

    // 运行时更新平滑窗口大小。
    function updateSmoothingWindowSizes({ earWindowSize, marWindowSize } = {}) {
        if (typeof earWindowSize === 'number' && !Number.isNaN(earWindowSize)) {
            earSmoothWindowSize = clampWindowSize(earWindowSize);
            if (earSmoothWindow.length > earSmoothWindowSize) {
                earSmoothWindow = earSmoothWindow.slice(-earSmoothWindowSize);
            }
        }

        if (typeof marWindowSize === 'number' && !Number.isNaN(marWindowSize)) {
            marSmoothWindowSize = clampWindowSize(marWindowSize);
            if (marSmoothWindow.length > marSmoothWindowSize) {
                marSmoothWindow = marSmoothWindow.slice(-marSmoothWindowSize);
            }
        }
    }

    // 获取当前平滑窗口配置。
    function getSmoothingWindowSizes() {
        return {
            earWindowSize: earSmoothWindowSize,
            marWindowSize: marSmoothWindowSize
        };
    }

    // 启动校准流程并重置校准采样。
    function startCalibration() {
        isCalibrating = true;
        calibrationStartTime = 0;
        calibrationEARValues = [];
    }

    // 每次新会话前重置运行时状态。
    function resetSessionRuntime() {
        epochStartTime = 0;
        perclosSamples = [];

        eyesClosedStartTime = 0;
        isEyesClosed = false;
        lastEyeAlertTime = 0;
        lastYawnTime = 0;
        yawnOpenStartTime = 0;
        yawnTriggeredInCurrentOpen = false;
        lastHeadMoveTime = 0;
        lastNosePosition = null;
        blinkTimestamps = [];
        earSmoothWindow = [];
        marSmoothWindow = [];
        ui.setBlinkRate(0);
    }

    // 绘制眼睛和嘴部轮廓辅助线。
    function drawFaceHighlights(landmarks) {
        window.drawConnectors(canvasCtx, landmarks, window.FACEMESH_RIGHT_EYE, { color: '#34d399', lineWidth: 2 });
        window.drawConnectors(canvasCtx, landmarks, window.FACEMESH_LEFT_EYE, { color: '#34d399', lineWidth: 2 });
        window.drawConnectors(canvasCtx, landmarks, window.FACEMESH_LIPS, { color: '#f87171', lineWidth: 2 });
    }

    // 检测头部位移并在超过阈值时记录事件。
    function handleHeadMove(landmarks, now) {
        const nose = landmarks[1];
        const leftEyeOuter = landmarks[33];
        const rightEyeOuter = landmarks[263];
        const eyeDx = leftEyeOuter.x - rightEyeOuter.x;
        const eyeDy = leftEyeOuter.y - rightEyeOuter.y;
        const eyeDistance = Math.sqrt(eyeDx * eyeDx + eyeDy * eyeDy);

        if (lastNosePosition) {
            const dx = nose.x - lastNosePosition.x;
            const dy = nose.y - lastNosePosition.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const normalizedDistance = eyeDistance > 0 ? (distance / eyeDistance) : 0;

            if (normalizedDistance > HEAD_MOVE_THRESHOLD && (now - lastHeadMoveTime > HEAD_MOVE_ALERT_COOLDOWN_MS)) {
                ui.triggerAlert('检测到头部大幅度移动！', 'warning');
                storage.recordEvent('c', normalizedDistance.toFixed(3));
                lastHeadMoveTime = now;
            }
        }
        lastNosePosition = { x: nose.x, y: nose.y };
    }

    // 处理校准阶段 EAR 采样并计算动态阈值。
    function handleCalibration(avgEAR, now) {
        if (calibrationStartTime === 0) {
            calibrationStartTime = now;
            const calibrationSeconds = CALIBRATION_DURATION_MS / 1000;
            ui.triggerAlert(`开始校准，请保持正常睁眼直视屏幕${calibrationSeconds}秒...`, 'info');
        }

        calibrationEARValues.push(avgEAR);
        ui.setCalibrationEAR(avgEAR);

        if (now - calibrationStartTime > CALIBRATION_DURATION_MS && calibrationEARValues.length > CALIBRATION_MIN_SAMPLES) {
            const sortedEARs = [...calibrationEARValues].sort();
            const topHalf = sortedEARs.slice(Math.floor(sortedEARs.length / 2));
            baselineEAR = topHalf.reduce((a, b) => a + b, 0) / topHalf.length;
            currentEarThreshold = baselineEAR * EAR_RATIO_THRESHOLD;

            ui.setEARThreshold(baselineEAR);
            ui.triggerAlert(`校准完成！闭眼阈值设为 < ${currentEarThreshold.toFixed(2)}`, 'info');
            isCalibrating = false;
        }
    }

    // 处理闭眼检测、长闭眼告警与 PERCLOS 统计。
    function handleEyeAndPerclos(avgEAR, now) {
        const isClosed = avgEAR < currentEarThreshold;
        ui.setEARValue(avgEAR, isClosed);

        if (isClosed) {
            if (!isEyesClosed) {
                isEyesClosed = true;
                eyesClosedStartTime = now;
            } else {
                const duration = now - eyesClosedStartTime;
                if (duration >= CLOSED_EYES_TIME && (now - lastEyeAlertTime > EYE_ALERT_COOLDOWN_MS)) {
                    ui.triggerAlert('单次长时间闭眼！', 'warning');
                    lastEyeAlertTime = now;
                }
            }
        } else if (isEyesClosed) {
            const duration = now - eyesClosedStartTime;
            if (duration >= CLOSED_EYES_TIME) {
                storage.recordEvent('a', duration);
            } else if (duration >= MIN_BLINK_DURATION_MS) {
                // 从闭眼切回睁眼且时长短于长闭眼阈值，记为一次合法眨眼。
                blinkTimestamps.push(now);
            }
            isEyesClosed = false;
        }

        pruneBlinkTimestamps(now);
        const blinkRateCount = blinkTimestamps.length;
        ui.setBlinkRate(blinkRateCount);

        if (epochStartTime === 0) epochStartTime = now;

        perclosSamples.push({ timestamp: now, isClosed });
        perclosSamples = perclosSamples.filter((sample) => (now - sample.timestamp) <= PERCLOS_EPOCH_MS);

        const closedCount = perclosSamples.reduce((acc, sample) => acc + (sample.isClosed ? 1 : 0), 0);
        const perclos = perclosSamples.length > 0 ? (closedCount / perclosSamples.length) : 0;
        ui.setPERCLOS(perclos);

        if (now - epochStartTime >= PERCLOS_EPOCH_MS) {
            storage.recordPerclosBlinkRate(perclos, blinkRateCount);
            epochStartTime = now;
        }
    }

    // 处理 MAR 与打哈欠告警。
    function handleYawn(smoothedMAR, now) {
        const isOpenWide = smoothedMAR > MAR_THRESHOLD;
        ui.setMARValue(smoothedMAR, isOpenWide);

        if (isOpenWide) {
            if (yawnOpenStartTime === 0) {
                yawnOpenStartTime = now;
                yawnTriggeredInCurrentOpen = false;
                return;
            }

            const openDuration = now - yawnOpenStartTime;
            if (
                !yawnTriggeredInCurrentOpen
                && openDuration >= YAWN_MIN_DURATION_MS
                && (now - lastYawnTime > YAWN_ALERT_COOLDOWN_MS)
            ) {
                ui.triggerAlert('检测到打哈欠！', 'warning');
                storage.recordEvent('b', smoothedMAR.toFixed(2));
                lastYawnTime = now;
                yawnTriggeredInCurrentOpen = true;
            }
            return;
        }

        yawnOpenStartTime = 0;
        yawnTriggeredInCurrentOpen = false;
    }

    // FaceMesh 每帧结果入口。
    function handleResults(results) {
        ui.setDetectingStateIfLoadingVisible();

        dom.canvasElement.width = results.image.width;
        dom.canvasElement.height = results.image.height;

        canvasCtx.save();
        canvasCtx.clearRect(0, 0, dom.canvasElement.width, dom.canvasElement.height);
        canvasCtx.drawImage(results.image, 0, 0, dom.canvasElement.width, dom.canvasElement.height);

        const now = Date.now();

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];

            drawFaceHighlights(landmarks);
            handleHeadMove(landmarks, now);

            const rightEAR = calculateEAR(landmarks, RIGHT_EYE_INDICES);
            const leftEAR = calculateEAR(landmarks, LEFT_EYE_INDICES);
            const avgEAR = (rightEAR + leftEAR) / 2.0;
            const smoothedEAR = getMovingAverage(earSmoothWindow, avgEAR, earSmoothWindowSize);
            const mar = calculateMAR(landmarks);
            const smoothedMAR = getMovingAverage(marSmoothWindow, mar, marSmoothWindowSize);

            if (isCalibrating) {
                handleCalibration(smoothedEAR, now);
            } else {
                handleEyeAndPerclos(smoothedEAR, now);
            }

            handleYawn(smoothedMAR, now);
        } else {
            ui.setNoFaceMetrics();
        }

        canvasCtx.restore();
    }

    return {
        startCalibration,
        resetSessionRuntime,
        handleResults
    };
}
