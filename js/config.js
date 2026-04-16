// 统一采集/处理帧率（FPS）。
export const PROCESS_FPS = 20;
// 处理帧间隔（毫秒），20FPS 对应 50ms。
export const PROCESS_INTERVAL_MS = Math.round(1000 / PROCESS_FPS);

// EAR 计算后与基准值比值阈值（低于该比例视为闭眼）。
export const EAR_RATIO_THRESHOLD = 0.6;
// MAR 超过该阈值判定为打哈欠。
export const MAR_THRESHOLD = 0.4;
// 连续闭眼达到该时长后触发长闭眼提示（毫秒）。
export const CLOSED_EYES_TIME = 1000;
// 头部位移阈值（鼻尖位移/双眼间距 的相对比率）。
export const HEAD_MOVE_THRESHOLD = 0.2;

// 长闭眼提示冷却时间（毫秒）。
export const EYE_ALERT_COOLDOWN_MS = 2000;
// 打哈欠提示冷却时间（毫秒）。
export const YAWN_ALERT_COOLDOWN_MS = 3000;
// MAR 超阈值持续该时长后才判定为打哈欠（毫秒）。
export const YAWN_MIN_DURATION_MS = 1500;
// 头部大幅移动提示冷却时间（毫秒）。
export const HEAD_MOVE_ALERT_COOLDOWN_MS = 3000;

// 校准阶段持续时长（毫秒）。
export const CALIBRATION_DURATION_MS = 5000;
// 校准最少采样数。
export const CALIBRATION_MIN_SAMPLES = 5;

// PERCLOS 与 BlinkRate 聚合统计周期（毫秒）。
export const PERCLOS_EPOCH_MS = 60000;

// 眨眼频率统计窗口（毫秒）。
export const BLINK_RATE_WINDOW_MS = 60000;
// 合法眨眼最小闭眼时长（毫秒），用于过滤抖动噪声。
export const MIN_BLINK_DURATION_MS = 60;

// EAR 滑动平均窗口大小（帧数）。
export const EAR_SMOOTH_WINDOW_SIZE = 5;
// MAR 滑动平均窗口大小（帧数）。
export const MAR_SMOOTH_WINDOW_SIZE = 5;

// 右眼关键点索引。
export const RIGHT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
// 左眼关键点索引。
export const LEFT_EYE_INDICES = [362, 385, 387, 263, 373, 380];

// UI 日志最大保留条目数。
export const LOG_MAX_ITEMS = 8;
