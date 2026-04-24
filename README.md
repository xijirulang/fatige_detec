# fatigue-detection

基于浏览器摄像头 + MediaPipe Face Mesh 的前端疲劳检测项目。项目聚焦于单人近景场景，提供实时告警、可视化指标与结构化日志导出（JSONL），适合演示、算法验证和轻量数据采集。

## 1. 功能概览

- 动态 EAR 校准：启动后先进行个体化睁眼基线校准，降低人群差异影响。
- 实时疲劳检测：
  - 长闭眼检测（事件 a）
  - 打哈欠检测（事件 b）
  - 头部大幅移动检测（事件 c）
- 连续指标展示：EAR、MAR、PERCLOS、Blink Rate。
- 双尺度数据记录：
  - 事件级记录（离散）
  - 每秒关键样本（1Hz）
  - 每 60 秒聚合记录（PERCLOS + Blink Rate）
- 导出格式：JSON Lines（.jsonl），便于流式处理与后续离线分析。
- 长时运行优化：滚动保留窗口（默认 8 小时）+ UI 限频刷新 + 滑窗增量统计。

## 2. 技术栈

- 前端构建：Vite
- 检测模型：MediaPipe Face Mesh（CDN 方式加载）
- UI：原生 HTML + Tailwind CSS（CDN）
- 语言：原生 ES Modules（无框架）

## 3. 目录结构

```text
fatige_detec/
├── index.html
├── detector_design.md
├── README.md
├── package.json
├── assets/
├── css/
│   └── style.css
└── js/
		├── main.js
		├── config.js
		├── dom.js
		├── camera.js
		├── detector.js
		├── storage.js
		├── ui.js
		└── utils.js
```

### 模块职责

- `js/main.js`
  - 应用入口，串联 DOM/UI/Detector/Storage/Camera。
  - 管理开始/停止检测与导出动作。
- `js/config.js`
  - 集中维护阈值、时间窗口、采样频率、性能参数。
- `js/camera.js`
  - 初始化 MediaPipe FaceMesh 与摄像头生命周期。
  - 通过固定间隔送帧降低算力消耗。
- `js/detector.js`
  - 核心算法实现：EAR/MAR、PERCLOS、BlinkRate、三类事件检测。
  - 秒级聚合（1Hz）并写入存储。
- `js/storage.js`
  - 会话期内数据持有、滚动裁剪、JSONL 导出。
- `js/ui.js`
  - 指标渲染、日志提示、状态切换。
  - 高频指标更新限频，减轻 DOM 写入开销。
- `js/utils.js`
  - 几何计算、时间工具、文本下载工具。

## 4. 快速开始

### 4.1 环境要求

- Node.js 18+
- npm 9+
- 支持摄像头访问的现代浏览器（Chrome/Edge 推荐）

### 4.2 安装与运行

```bash
npm install
npm run dev
```

打开命令行输出的本地地址（通常是 http://localhost:5173）。

### 4.3 构建与预览

```bash
npm run build
npm run preview
```

## 5. 使用流程

1. 点击“启动摄像头开始检测”。
2. 允许浏览器摄像头权限。
3. 进入校准阶段（默认 5 秒）：保持正常睁眼，直视屏幕。
4. 校准完成后进入实时检测，系统持续显示指标并记录日志。
5. 点击“停止检测”结束会话。
6. 点击“导出日志”下载 JSONL 文件。

说明：

- 会在支持的浏览器中尝试申请屏幕常亮（Wake Lock），减少长时间运行时熄屏影响。
- 停止检测时会执行尾样本 flush，确保最后一秒聚合不丢失。

## 6. 检测逻辑（实现对齐版）

### 6.1 EAR（闭眼特征）

- 使用双眼关键点计算 EAR，取左右眼平均。
- 启动后先做个体化校准，得到 `baselineEAR`。
- 闭眼阈值：`currentEarThreshold = baselineEAR * EAR_RATIO_THRESHOLD`。

### 6.2 长闭眼与眨眼

- 当 `EAR < currentEarThreshold` 进入闭眼状态。
- 闭眼持续时间 >= `CLOSED_EYES_TIME` 触发长闭眼告警，并记录事件 `a`。
- 短闭眼且时长 >= `MIN_BLINK_DURATION_MS` 记为一次合法眨眼。

### 6.3 MAR（打哈欠）

- 当 `MAR > MAR_THRESHOLD` 且持续时间 >= `YAWN_MIN_DURATION_MS` 触发打哈欠。
- 记录事件 `b`（值为 MAR）。

### 6.4 头部移动

- 使用鼻尖帧间位移，并用双眼外眼角距离归一化。
- 超过 `HEAD_MOVE_THRESHOLD` 且满足冷却条件时触发事件 `c`。

### 6.5 PERCLOS 与 BlinkRate

- 使用 60 秒滑窗维护闭眼样本占比（PERCLOS），逐帧更新。
- 合法眨眼时间戳保持 60 秒窗口，窗口数量即 BlinkRate。
- 每 60 秒写入一次聚合记录（perclosMinute）。

### 6.6 每秒关键样本（1Hz）

- 按秒槽聚合每帧数据。
- 每秒输出一条 perSecond 记录：EAR/MAR 均值、闭眼占比、眨眼增量、头动峰值/均值、当前 PERCLOS/BlinkRate、告警计数。

## 7. 导出日志格式（JSONL）

导出文件扩展名：`.jsonl`，每行是一个独立 JSON 对象。

### 7.1 文件组织

1. 首行：`type = session`（会话元信息）
2. 中间：
   - `type = event`（离散事件）
   - `type = perSecond`（秒级样本）
   - `type = perclosMinute`（60 秒聚合）
3. 末行：`type = sessionEnd`

### 7.2 字段示例

```json
{"type":"session","sessionStartTime":"2026-04-24 20:00:00.123","loggingStartTime":"2026-04-24 20:00:05.130","loggingEndTime":"2026-04-24 20:10:00.002","exportedAt":"2026-04-24 20:10:02.100","retentionHours":8,"counters":{"events":6,"perSecondSamples":595,"perclosEpochs":10}}
{"type":"event","timestampMs":1713950407123,"timestamp":"2026-04-24 20:00:07.123","eventType":"a","value":1180}
{"type":"perSecond","timestampMs":1713950410000,"timestamp":"2026-04-24 20:00:10.000","earAvg":0.263,"marAvg":0.318,"closedRatio":0.22,"blinkDelta":1,"headMovePeak":0.146,"headMoveAvg":0.052,"perclos":0.14,"blinkRate":18,"eyeAlerts":0,"yawnAlerts":0,"headMoveAlerts":0}
{"type":"perclosMinute","timestampMs":1713950460000,"timestamp":"2026-04-24 20:01:00.000","perclos":0.18,"blinkRate":17}
{"type":"sessionEnd","loggingEndTime":"2026-04-24 20:10:00.002","exportedAt":"2026-04-24 20:10:02.100"}
```

### 7.3 事件编码约定

- `a`: 单次长闭眼（value 通常为持续时长 ms）
- `b`: 打哈欠（value 通常为 MAR 值）
- `c`: 头部大幅移动（value 通常为归一化位移）

## 8. 关键配置参数

以下参数位于 `js/config.js`。

| 参数                        | 默认值 | 说明                             |
| --------------------------- | -----: | -------------------------------- |
| PROCESS_FPS                 |     20 | 算法处理帧率（目标）             |
| PROCESS_INTERVAL_MS         |     50 | 送帧间隔                         |
| SECOND_SAMPLE_INTERVAL_MS   |   1000 | 秒级样本输出间隔                 |
| DATA_PRUNE_INTERVAL_MS      |  30000 | 数据滚动裁剪执行间隔             |
| DATA_RETENTION_HOURS        |      8 | 内存保留窗口（小时）             |
| UI_UPDATE_INTERVAL_MS       |    150 | UI 指标刷新最小间隔              |
| EAR_RATIO_THRESHOLD         |    0.6 | 闭眼阈值比例（相对 baselineEAR） |
| MAR_THRESHOLD               |    0.4 | 打哈欠阈值                       |
| CLOSED_EYES_TIME            |   1000 | 长闭眼判定时长                   |
| HEAD_MOVE_THRESHOLD         |    0.2 | 头部位移阈值（归一化）           |
| EYE_ALERT_COOLDOWN_MS       |   2000 | 长闭眼告警冷却                   |
| YAWN_ALERT_COOLDOWN_MS      |   3000 | 哈欠告警冷却                     |
| YAWN_MIN_DURATION_MS        |   1500 | 哈欠持续时长约束                 |
| HEAD_MOVE_ALERT_COOLDOWN_MS |   3000 | 头动告警冷却                     |
| CALIBRATION_DURATION_MS     |   5000 | 校准时长                         |
| CALIBRATION_MIN_SAMPLES     |      5 | 校准最少样本数                   |
| PERCLOS_EPOCH_MS            |  60000 | PERCLOS/BlinkRate 聚合周期       |
| BLINK_RATE_WINDOW_MS        |  60000 | 眨眼统计窗口                     |
| MIN_BLINK_DURATION_MS       |     60 | 合法眨眼最小闭眼时长             |
| EAR_SMOOTH_WINDOW_SIZE      |      1 | EAR 平滑窗口                     |
| MAR_SMOOTH_WINDOW_SIZE      |      5 | MAR 平滑窗口                     |

## 9. 性能与长时间运行建议

- 保持浏览器前台运行，避免后台标签页导致定时/渲染降频。
- 尽量固定拍摄距离和角度，减少姿态剧烈变化造成噪声。
- 如果设备发热明显：
  1. 可降低 `PROCESS_FPS`（例如 15）
  2. 适当增大 `UI_UPDATE_INTERVAL_MS`
- 如果需要更长采集时长：
  1. 适当提高 `DATA_RETENTION_HOURS`
  2. 或缩短导出间隔，分段归档

## 10. 隐私与数据说明

- 本项目默认在浏览器本地运行。
- 不会自动上传视频流或日志到远端服务器。
- 导出文件由用户主动触发下载。
- 如需接入后端，请自行补充数据合规、脱敏和传输加密策略。

## 11. 常见问题（FAQ）

### Q1: 点击启动后无画面或报权限错误？

- 检查浏览器是否允许摄像头权限。
- 使用 localhost 或 HTTPS。
- 确认系统级摄像头未被其他程序独占。

### Q2: 指标跳动大、误报偏多？

- 先确保校准阶段姿态稳定。
- 适当调整阈值：`EAR_RATIO_THRESHOLD`、`MAR_THRESHOLD`、`HEAD_MOVE_THRESHOLD`。
- 提升光照质量，避免强逆光。

### Q3: 导出的 JSONL 如何分析？

- 按行读取 JSON，再按 `type` 分流到不同表。
- `perSecond` 可直接做时序图。
- `event` 可用于事件回放与告警统计。

## 12. 开发者说明

- 如需深入算法细节，可参考 `detector_design.md`（部分参数可能滞后，以代码为准）。
- 推荐改动路径：
  1. 先改 `js/config.js` 参数
  2. 再改 `js/detector.js` 逻辑
  3. 最后检查 `js/storage.js` 导出字段一致性

## 13. License

当前仓库未显式声明开源许可证。若要开源发布，建议补充 `LICENSE` 文件。
