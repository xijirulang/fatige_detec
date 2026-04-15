// 统一获取页面中检测系统所需的 DOM 元素。
export function getDomElements() {
    return {
        // 摄像头视频输入元素（仅用于提供帧，不直接显示）。
        videoElement: document.getElementById('inputVideo'),
        // 绘制检测结果的画布。
        canvasElement: document.getElementById('outputCanvas'),
        // 启停检测按钮。
        toggleBtn: document.getElementById('toggleBtn'),
        // 顶部状态标签。
        statusIndicator: document.getElementById('statusIndicator'),
        // 视频与画布容器（用于警示闪烁效果）。
        screenContainer: document.getElementById('screenContainer'),
        // 模型加载遮罩层。
        loadingOverlay: document.getElementById('loadingOverlay'),
        // EAR 数值显示。
        earValueEl: document.getElementById('earValue'),
        // EAR 基准阈值显示。
        earThresholdEl: document.getElementById('earThresholdEl'),
        // MAR 数值显示。
        marValueEl: document.getElementById('marValue'),
        // PERCLOS 数值显示。
        perclosValueEl: document.getElementById('perclosValue'),
        // 眨眼频率显示（过去 60 秒眨眼次数，可选）。
        blinkRateEl: document.getElementById('blinkRateValue'),
        // 日志列表容器。
        logList: document.getElementById('logList'),
        // 导出按钮。
        exportBtn: document.getElementById('exportBtn')
    };
}
