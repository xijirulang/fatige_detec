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
    SECOND_SAMPLE_INTERVAL_MS,
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
    let closedSampleCount = 0;

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
    let earWindow = [];
    let marWindow = [];
    let secondBucket = null;
    let currentSecondSlot = 0;

    function createSecondBucket() {
        return {
            frameCount: 0,
            earSum: 0,
            marSum: 0,
            closedCount: 0,
            blinkDelta: 0,
            headMovePeak: 0,
            headMoveSum: 0,
            eyeAlertCount: 0,
            yawnAlertCount: 0,
            headMoveAlertCount: 0,
            lastPerclos: 0,
            lastBlinkRate: 0
        };
    }

    function resetSecondSampling() {
        secondBucket = createSecondBucket();
        currentSecondSlot = 0;
    }

    function flushSecondSample(timestampMs) {
        if (!secondBucket || secondBucket.frameCount === 0) {
            return;
        }

        const frameCount = secondBucket.frameCount;
        storage.recordPerSecondSample({
            earAvg: secondBucket.earSum / frameCount,
            marAvg: secondBucket.marSum / frameCount,
            closedRatio: secondBucket.closedCount / frameCount,
            blinkDelta: secondBucket.blinkDelta,
            headMovePeak: secondBucket.headMovePeak,
            headMoveAvg: secondBucket.headMoveSum / frameCount,
            perclos: secondBucket.lastPerclos,
            blinkRate: secondBucket.lastBlinkRate,
            eyeAlerts: secondBucket.eyeAlertCount,
            yawnAlerts: secondBucket.yawnAlertCount,
            headMoveAlerts: secondBucket.headMoveAlertCount
        }, timestampMs);

        secondBucket = createSecondBucket();
    }

    function updateSecondSampling(metrics, now) {
        const secondSlot = Math.floor(now / SECOND_SAMPLE_INTERVAL_MS);
        if (currentSecondSlot === 0) {
            currentSecondSlot = secondSlot;
        } else if (secondSlot !== currentSecondSlot) {
            flushSecondSample(currentSecondSlot * SECOND_SAMPLE_INTERVAL_MS);
            currentSecondSlot = secondSlot;
        }

        secondBucket.frameCount += 1;
        secondBucket.earSum += metrics.ear;
        secondBucket.marSum += metrics.mar;
        secondBucket.closedCount += metrics.isClosed ? 1 : 0;
        secondBucket.blinkDelta += metrics.blinkDelta;
        secondBucket.headMovePeak = Math.max(secondBucket.headMovePeak, metrics.headMoveDistance);
        secondBucket.headMoveSum += metrics.headMoveDistance;
        secondBucket.eyeAlertCount += metrics.eyeAlert ? 1 : 0;
        secondBucket.yawnAlertCount += metrics.yawnAlert ? 1 : 0;
        secondBucket.headMoveAlertCount += metrics.headMoveAlert ? 1 : 0;
        secondBucket.lastPerclos = metrics.perclos;
        secondBucket.lastBlinkRate = metrics.blinkRate;
    }

    // 维护定长滑动窗口并返回当前均值。
    function pushAndGetAverage(windowValues, value, maxSize) {
        windowValues.push(value);
        if (windowValues.length > maxSize) {
            windowValues.shift();
        }
        const sum = windowValues.reduce((acc, current) => acc + current, 0);
        return windowValues.length > 0 ? (sum / windowValues.length) : value;
    }

    // 仅保留统计窗口内的眨眼时间戳。
    function pruneBlinkTimestamps(now) {
        while (blinkTimestamps.length > 0 && (now - blinkTimestamps[0]) > BLINK_RATE_WINDOW_MS) {
            blinkTimestamps.shift();
        }
    }

    // 启动校准流程并重置校准采样。
    function startCalibration() {
        isCalibrating = true;
        calibrationStartTime = 0;
        calibrationEARValues = [];
        earWindow = [];
        marWindow = [];
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
        earWindow = [];
        marWindow = [];
        closedSampleCount = 0;
        resetSecondSampling();
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
                lastNosePosition = { x: nose.x, y: nose.y };
                return { normalizedDistance, alerted: true };
            }

            lastNosePosition = { x: nose.x, y: nose.y };
            return { normalizedDistance, alerted: false };
        }
        lastNosePosition = { x: nose.x, y: nose.y };
        return { normalizedDistance: 0, alerted: false };
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

            storage.markLoggingStart(now);
            ui.setEARThreshold(baselineEAR);
            ui.triggerAlert(`校准完成！闭眼阈值设为 < ${currentEarThreshold.toFixed(2)}`, 'info');
            isCalibrating = false;
        }
    }

    // 处理闭眼检测、长闭眼告警与 PERCLOS 统计。
    function handleEyeAndPerclos(avgEAR, now) {
        const isClosed = avgEAR < currentEarThreshold;
        ui.setEARValue(avgEAR, isClosed);
        let blinkDelta = 0;
        let eyeAlertTriggered = false;

        if (isClosed) {
            if (!isEyesClosed) {
                isEyesClosed = true;
                eyesClosedStartTime = now;
            } else {
                const duration = now - eyesClosedStartTime;
                if (duration >= CLOSED_EYES_TIME && (now - lastEyeAlertTime > EYE_ALERT_COOLDOWN_MS)) {
                    ui.triggerAlert('单次长时间闭眼！', 'warning');
                    lastEyeAlertTime = now;
                    eyeAlertTriggered = true;
                }
            }
        } else if (isEyesClosed) {
            const duration = now - eyesClosedStartTime;
            if (duration >= CLOSED_EYES_TIME) {
                storage.recordEvent('a', duration);
            } else if (duration >= MIN_BLINK_DURATION_MS) {
                // 从闭眼切回睁眼且时长短于长闭眼阈值，记为一次合法眨眼。
                blinkTimestamps.push(now);
                blinkDelta = 1;
            }
            isEyesClosed = false;
        }

        pruneBlinkTimestamps(now);
        const blinkRateCount = blinkTimestamps.length;
        ui.setBlinkRate(blinkRateCount);

        if (epochStartTime === 0) epochStartTime = now;

        perclosSamples.push({ timestamp: now, isClosed });
        if (isClosed) {
            closedSampleCount += 1;
        }

        while (perclosSamples.length > 0 && (now - perclosSamples[0].timestamp) > PERCLOS_EPOCH_MS) {
            const expired = perclosSamples.shift();
            if (expired.isClosed) {
                closedSampleCount -= 1;
            }
        }

        const perclos = perclosSamples.length > 0 ? (closedSampleCount / perclosSamples.length) : 0;
        ui.setPERCLOS(perclos);

        if (now - epochStartTime >= PERCLOS_EPOCH_MS) {
            storage.recordPerclosBlinkRate(perclos, blinkRateCount);
            epochStartTime = now;
        }

        return {
            isClosed,
            blinkDelta,
            perclos,
            blinkRate: blinkRateCount,
            eyeAlertTriggered
        };
    }

    // 处理 MAR 与打哈欠告警。
    function handleYawn(smoothedMAR, now) {
        const isOpenWide = smoothedMAR > MAR_THRESHOLD;
        ui.setMARValue(smoothedMAR, isOpenWide);
        let yawnAlertTriggered = false;

        if (isOpenWide) {
            if (yawnOpenStartTime === 0) {
                yawnOpenStartTime = now;
                yawnTriggeredInCurrentOpen = false;
                return { yawnAlertTriggered };
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
                yawnAlertTriggered = true;
            }
            return { yawnAlertTriggered };
        }

        yawnOpenStartTime = 0;
        yawnTriggeredInCurrentOpen = false;
        return { yawnAlertTriggered };
    }

    function flushPendingSamples(flushTime = Date.now()) {
        flushSecondSample(flushTime);
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
            const headMoveResult = handleHeadMove(landmarks, now);

            const rightEAR = calculateEAR(landmarks, RIGHT_EYE_INDICES);
            const leftEAR = calculateEAR(landmarks, LEFT_EYE_INDICES);
            const avgEAR = (rightEAR + leftEAR) / 2.0;
            const mar = calculateMAR(landmarks);
            const smoothedEAR = pushAndGetAverage(earWindow, avgEAR, EAR_SMOOTH_WINDOW_SIZE);
            const smoothedMAR = pushAndGetAverage(marWindow, mar, MAR_SMOOTH_WINDOW_SIZE);

            if (isCalibrating) {
                handleCalibration(smoothedEAR, now);
            } else {
                const eyeMetrics = handleEyeAndPerclos(smoothedEAR, now);
                const yawnMetrics = handleYawn(smoothedMAR, now);
                updateSecondSampling({
                    ear: smoothedEAR,
                    mar: smoothedMAR,
                    isClosed: eyeMetrics.isClosed,
                    blinkDelta: eyeMetrics.blinkDelta,
                    headMoveDistance: headMoveResult.normalizedDistance,
                    headMoveAlert: headMoveResult.alerted,
                    eyeAlert: eyeMetrics.eyeAlertTriggered,
                    yawnAlert: yawnMetrics.yawnAlertTriggered,
                    perclos: eyeMetrics.perclos,
                    blinkRate: eyeMetrics.blinkRate
                }, now);
            }
            if (isCalibrating) {
                handleYawn(smoothedMAR, now);
            }
        } else {
            ui.setNoFaceMetrics();
        }

        canvasCtx.restore();
    }

    return {
        startCalibration,
        resetSessionRuntime,
        flushPendingSamples,
        handleResults
    };
}
