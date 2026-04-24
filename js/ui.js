import { LOG_MAX_ITEMS, UI_UPDATE_INTERVAL_MS } from './config.js';
import { getNowTimeText } from './utils.js';

// 负责页面状态、日志与指标展示的 UI 控制器。
export function createUI(dom) {
    const metricRenderTimes = {
        ear: 0,
        mar: 0,
        perclos: 0,
        blink: 0
    };

    function shouldRenderMetric(metricKey, force = false) {
        if (force) return true;
        const now = Date.now();
        if ((now - metricRenderTimes[metricKey]) < UI_UPDATE_INTERVAL_MS) {
            return false;
        }
        metricRenderTimes[metricKey] = now;
        return true;
    }

    // 在日志顶部插入一条记录并限制最大条数。
    function prependLog(html) {
        const li = document.createElement('li');
        li.innerHTML = html;
        dom.logList.prepend(li);
        if (dom.logList.children.length > LOG_MAX_ITEMS) {
            dom.logList.removeChild(dom.logList.lastChild);
        }
    }

    // 统一触发日志与视觉提示。
    function triggerAlert(message, type) {
        const timeStr = getNowTimeText();

        if (type === 'critical') {
            prependLog(`<span class="text-red-400">[${timeStr}] ⚠️ ${message}</span>`);
            dom.screenContainer.classList.add('warning-flash');
            dom.statusIndicator.innerText = '疲劳警告！';
            dom.statusIndicator.className = 'px-3 py-1 rounded-full text-sm font-semibold bg-red-600 animate-pulse';
            setTimeout(() => {
                dom.screenContainer.classList.remove('warning-flash');
                dom.statusIndicator.innerText = '检测中';
                dom.statusIndicator.className = 'px-3 py-1 rounded-full text-sm font-semibold bg-green-600';
            }, 1500);
            return;
        }

        if (type === 'warning') {
            prependLog(`<span class="text-orange-400">[${timeStr}] ⚠️ ${message}</span>`);
            return;
        }

        if (type === 'info') {
            prependLog(`<span class="text-blue-400">[${timeStr}] ℹ️ ${message}</span>`);
            return;
        }

        prependLog(`<span class="text-yellow-400">[${timeStr}] ⚡ ${message}</span>`);
    }

    // 显示模型加载中的日志。
    function showModelLoadingLog() {
        dom.logList.innerHTML = `<li class="text-blue-400">[${getNowTimeText()}] 正在下载并加载模型...</li>`;
    }

    // 设置“启动中”界面状态。
    function setStartingState() {
        dom.loadingOverlay.classList.remove('hidden');
        dom.loadingOverlay.classList.add('flex');

        dom.toggleBtn.innerText = '停止检测';
        dom.toggleBtn.className = 'flex-1 py-4 rounded-xl text-lg font-bold bg-red-600 hover:bg-red-500 active:bg-red-700 transition-colors shadow-lg';

        dom.exportBtn.classList.remove('hidden');

        dom.statusIndicator.innerText = '正在启动...';
        dom.statusIndicator.className = 'px-3 py-1 rounded-full text-sm font-semibold bg-yellow-600';

        dom.earThresholdEl.innerText = '待校准...';
    }

    // 若当前仍处于加载遮罩状态，则切换为“检测中”。
    function setDetectingStateIfLoadingVisible() {
        if (!dom.loadingOverlay.classList.contains('flex')) return;
        dom.loadingOverlay.classList.remove('flex');
        dom.loadingOverlay.classList.add('hidden');
        dom.statusIndicator.innerText = '检测中';
        dom.statusIndicator.className = 'px-3 py-1 rounded-full text-sm font-semibold bg-green-600';
    }

    // 设置“已停止”界面状态。
    function setStoppedState() {
        dom.toggleBtn.innerText = '启动摄像头开始检测';
        dom.toggleBtn.className = 'flex-1 py-4 rounded-xl text-lg font-bold bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition-colors shadow-lg';

        dom.statusIndicator.innerText = '已停止';
        dom.statusIndicator.className = 'px-3 py-1 rounded-full text-sm font-semibold bg-gray-600';

        dom.logList.innerHTML = `<li class="text-gray-500">[${getNowTimeText()}] 系统已暂停。</li>`;
    }

    // 启动失败后的界面回退。
    function setStartFailedState() {
        dom.toggleBtn.innerText = '启动摄像头开始检测';
        dom.toggleBtn.className = 'flex-1 py-4 rounded-xl text-lg font-bold bg-blue-600 hover:bg-blue-500 active:bg-blue-700 transition-colors shadow-lg';
        dom.loadingOverlay.classList.add('hidden');
        dom.loadingOverlay.classList.remove('flex');
    }

    // 校准阶段的 EAR 显示样式。
    function setCalibrationEAR(ear) {
        if (!shouldRenderMetric('ear')) return;
        dom.earValueEl.innerText = ear.toFixed(2);
        dom.earValueEl.className = 'text-lg font-mono font-bold text-yellow-400';
    }

    // 常规检测阶段 EAR 显示与颜色。
    function setEARValue(ear, isClosed, force = false) {
        if (!shouldRenderMetric('ear', force)) return;
        dom.earValueEl.innerText = ear.toFixed(2);
        dom.earValueEl.className = `text-lg font-mono font-bold ${isClosed ? 'text-red-500' : 'text-green-400'}`;
    }

    // 显示 EAR 基准阈值。
    function setEARThreshold(baselineEAR) {
        dom.earThresholdEl.innerText = `基准:${baselineEAR.toFixed(2)}`;
    }

    // 显示 MAR 值与颜色。
    function setMARValue(mar, isOpenWide, force = false) {
        if (!shouldRenderMetric('mar', force)) return;
        dom.marValueEl.innerText = mar.toFixed(2);
        dom.marValueEl.className = `text-lg font-mono font-bold ${isOpenWide ? 'text-red-500' : 'text-green-400'}`;
    }

    // 显示 PERCLOS 百分比。
    function setPERCLOS(perclos, force = false) {
        if (!shouldRenderMetric('perclos', force)) return;
        dom.perclosValueEl.innerText = `${(perclos * 100).toFixed(1)}%`;
        dom.perclosValueEl.className = 'text-lg font-mono font-bold text-blue-400';
    }

    // 预留眨眼频率显示接口：统计过去 60 秒内的眨眼次数。
    function setBlinkRate(count, force = false) {
        if (!dom.blinkRateEl) return;
        if (!shouldRenderMetric('blink', force)) return;
        dom.blinkRateEl.innerText = `${count}`;
        dom.blinkRateEl.className = 'text-lg font-mono font-bold text-cyan-400';
    }

    // 未检测到人脸时的占位显示。
    function setNoFaceMetrics() {
        dom.earValueEl.innerText = '---';
        dom.marValueEl.innerText = '---';
        dom.perclosValueEl.innerText = '---';
    }

    // 停止检测时重置指标显示。
    function resetMetrics() {
        setEARValue(0, false, true);
        setMARValue(0, false, true);
        setPERCLOS(0, true);
        setBlinkRate(0, true);
    }

    return {
        triggerAlert,
        showModelLoadingLog,
        setStartingState,
        setDetectingStateIfLoadingVisible,
        setStoppedState,
        setStartFailedState,
        setCalibrationEAR,
        setEARValue,
        setEARThreshold,
        setMARValue,
        setPERCLOS,
        setBlinkRate,
        setNoFaceMetrics,
        resetMetrics
    };
}
