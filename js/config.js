// 处理帧间隔（毫秒），100ms 约等于 10FPS。
export const PROCESS_INTERVAL_MS = 100;

// EAR 计算后与基准值比值阈值（低于该比例视为闭眼）。
export const EAR_RATIO_THRESHOLD = 0.6;
// MAR 超过该阈值判定为打哈欠。
export const MAR_THRESHOLD = 0.5;
// 连续闭眼达到该时长后触发长闭眼提示（毫秒）。
export const CLOSED_EYES_TIME = 1000;
// 头部位移阈值（归一化坐标距离）。
export const HEAD_MOVE_THRESHOLD = 0.05;

// 长闭眼提示冷却时间（毫秒）。
export const EYE_ALERT_COOLDOWN_MS = 2000;
// 打哈欠提示冷却时间（毫秒）。
export const YAWN_ALERT_COOLDOWN_MS = 3000;
// 头部大幅移动提示冷却时间（毫秒）。
export const HEAD_MOVE_ALERT_COOLDOWN_MS = 2000;

// 校准阶段持续时长（毫秒）。
export const CALIBRATION_DURATION_MS = 2000;
// 校准最少采样数。
export const CALIBRATION_MIN_SAMPLES = 5;

// PERCLOS 统计周期（毫秒）。
export const PERCLOS_EPOCH_MS = 5000;

// 右眼关键点索引。
export const RIGHT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
// 左眼关键点索引。
export const LEFT_EYE_INDICES = [362, 385, 387, 263, 373, 380];

// UI 日志最大保留条目数。
export const LOG_MAX_ITEMS = 50;
