import {
    EAR_RATIO_THRESHOLD,
    MAR_THRESHOLD,
    CLOSED_EYES_TIME,
    HEAD_MOVE_THRESHOLD,
    EYE_ALERT_COOLDOWN_MS,
    YAWN_ALERT_COOLDOWN_MS,
    HEAD_MOVE_ALERT_COOLDOWN_MS,
    CALIBRATION_DURATION_MS,
    CALIBRATION_MIN_SAMPLES,
    PERCLOS_EPOCH_MS,
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
    let currentEpochFrames = 0;
    let currentEpochClosedFrames = 0;

    // 事件检测计时状态。
    let eyesClosedStartTime = 0;
    let isEyesClosed = false;
    let lastEyeAlertTime = 0;
    let lastYawnTime = 0;
    let lastHeadMoveTime = 0;
    let lastNosePosition = null;

    // 启动校准流程并重置校准采样。
    function startCalibration() {
        isCalibrating = true;
        calibrationStartTime = 0;
        calibrationEARValues = [];
    }

    // 每次新会话前重置运行时状态。
    function resetSessionRuntime() {
        epochStartTime = 0;
        currentEpochFrames = 0;
        currentEpochClosedFrames = 0;

        eyesClosedStartTime = 0;
        isEyesClosed = false;
        lastEyeAlertTime = 0;
        lastYawnTime = 0;
        lastHeadMoveTime = 0;
        lastNosePosition = null;
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
        if (lastNosePosition) {
            const dx = nose.x - lastNosePosition.x;
            const dy = nose.y - lastNosePosition.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > HEAD_MOVE_THRESHOLD && (now - lastHeadMoveTime > HEAD_MOVE_ALERT_COOLDOWN_MS)) {
                ui.triggerAlert('检测到头部大幅度移动！', 'warning');
                storage.recordEvent('c', distance.toFixed(3));
                lastHeadMoveTime = now;
            }
        }
        lastNosePosition = { x: nose.x, y: nose.y };
    }

    // 处理校准阶段 EAR 采样并计算动态阈值。
    function handleCalibration(avgEAR, now) {
        if (calibrationStartTime === 0) {
            calibrationStartTime = now;
            ui.triggerAlert('开始校准，请保持正常睁眼直视屏幕2秒...', 'info');
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
            }
            isEyesClosed = false;
        }

        if (epochStartTime === 0) epochStartTime = now;

        currentEpochFrames++;
        if (isClosed) currentEpochClosedFrames++;

        if (now - epochStartTime >= PERCLOS_EPOCH_MS) {
            const perclos = currentEpochFrames > 0 ? (currentEpochClosedFrames / currentEpochFrames) : 0;
            storage.recordPerclos(perclos);
            ui.setPERCLOS(perclos);

            currentEpochFrames = 0;
            currentEpochClosedFrames = 0;
            epochStartTime = now;
        }
    }

    // 处理 MAR 与打哈欠告警。
    function handleYawn(landmarks, now) {
        const mar = calculateMAR(landmarks);
        const isOpenWide = mar > MAR_THRESHOLD;
        ui.setMARValue(mar, isOpenWide);

        if (isOpenWide && (now - lastYawnTime > YAWN_ALERT_COOLDOWN_MS)) {
            ui.triggerAlert('检测到打哈欠！', 'warning');
            storage.recordEvent('b', mar.toFixed(2));
            lastYawnTime = now;
        }
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

            if (isCalibrating) {
                handleCalibration(avgEAR, now);
            } else {
                handleEyeAndPerclos(avgEAR, now);
            }

            handleYawn(landmarks, now);
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
