# 检测算法设计说明

## 1. 目标与范围

本文档描述网页端疲劳检测的算法实现，面向单人正脸场景，基于 MediaPipe FaceMesh 关键点进行以下检测：

- 闭眼状态与单次长闭眼事件
- 打哈欠事件
- 头部大幅位移事件
- 周期性 PERCLOS（闭眼占比）统计

检测结果用于：

- 实时界面提示与状态变更
- 事件日志记录
- PERCLOS 连续序列记录与 CSV 导出

## 2. 总体流程

1. 启动检测：初始化摄像头与 FaceMesh，开启会话并清空历史数据。
2. 校准阶段（约 5 秒）：采集用户自然睁眼 EAR，计算个体化闭眼阈值。
3. 实时检测阶段：按固定帧间隔处理关键点，计算 EAR/MAR，并基于平滑信号检测事件。
4. 周期统计：每 60 秒输出一次聚合指标（PERCLOS + Blink Rate）。
5. 停止检测：停止摄像头，保留会话内记录供导出。

## 3. 输入与输出

### 3.1 输入

- 视频流：前置摄像头实时画面。
- 人脸关键点：FaceMesh 输出的 468 点归一化坐标（x,y,z）。

当前仅使用首张人脸 `multiFaceLandmarks[0]`。

### 3.2 输出

- 实时指标：EAR、MAR、PERCLOS、Blink Rate（过去 60 秒眨眼次数）。
- 离散事件：
  - `a`：单次长闭眼（记录闭眼时长 ms）
  - `b`：打哈欠（记录 MAR）
  - `c`：头部大幅移动（记录位移距离）
- 导出文件：
  - `<开始时间>_events.csv`（疲劳事件）
  - `<开始时间>_eyes_trans.csv`（60 秒聚合指标）

## 4. 关键点与特征定义

### 4.1 眼部关键点

- 右眼索引：`[33, 160, 158, 133, 153, 144]`
- 左眼索引：`[362, 385, 387, 263, 373, 380]`

单眼 EAR（Eye Aspect Ratio）定义：

$$
EAR = \frac{\|p_2-p_6\| + \|p_3-p_5\|}{2\cdot\|p_1-p_4\|}
$$

左右眼取平均：

$$
EAR_{avg} = \frac{EAR_{right}+EAR_{left}}{2}
$$

### 4.2 嘴部关键点

- 上下唇中心：13, 14
- 嘴角：78, 308

MAR（Mouth Aspect Ratio）定义：

$$
MAR = \frac{\|p_{13}-p_{14}\|}{\|p_{78}-p_{308}\|}
$$

### 4.3 头部位移参考点

- 鼻尖近似点：索引 `1`

帧间位移：

$$
d = \sqrt{(x_t-x_{t-1})^2 + (y_t-y_{t-1})^2}
$$

## 5. 个体化校准策略（EAR 动态阈值）

为减少个体差异影响，系统在每次启动后先进入短时校准：

1. 收集约 `CALIBRATION_DURATION_MS = 2000ms` 内的 `EAR_avg` 样本。
2. 样本数量需大于 `CALIBRATION_MIN_SAMPLES = 5`。
3. 对样本升序排序，仅取上半部分（降低眨眼低值干扰）。
4. 计算上半部分均值作为 `baselineEAR`。
5. 最终闭眼阈值：

$$
EAR_{th} = baselineEAR \times EAR\_RATIO\_THRESHOLD
$$

其中 `EAR_RATIO_THRESHOLD = 0.6`。

说明：若校准阶段出现短暂眨眼，取上半区均值可提高阈值稳定性。

## 6. 实时检测逻辑

### 6.1 处理频率控制

为平衡性能与发热，采用降频送帧：

- `PROCESS_FPS = 20`，对应 `PROCESS_INTERVAL_MS = 50ms` 的算法处理频率。

### 6.2 信号平滑（Moving Average）

为减少 FaceMesh 帧间关键点抖动导致的瞬时误判，EAR 与 MAR 在判定前均做滑动平均：

- EAR 平滑窗口：`EAR_SMOOTH_WINDOW_SIZE = 5` 帧
- MAR 平滑窗口：`MAR_SMOOTH_WINDOW_SIZE = 5` 帧

设原始序列为 $x_t$，窗口大小为 $N$，平滑值为：

$$
\bar{x}_t = \frac{1}{N_t}\sum_{i=t-N_t+1}^{t} x_i,
\quad N_t = \min(N, t)
$$

### 6.3 闭眼、长闭眼与眨眼判定

闭眼条件（使用平滑 EAR）：

$$
EAR_{smooth} < EAR_{th}
$$

状态机逻辑：

1. 首次进入闭眼：记录 `eyesClosedStartTime`。
2. 持续闭眼时计算持续时长 `duration = now - eyesClosedStartTime`。
3. 当 `duration >= CLOSED_EYES_TIME (1000ms)`，触发长闭眼告警（带冷却）。
4. 从闭眼恢复到睁眼时：

- 若 `duration >= CLOSED_EYES_TIME`，记录事件 `a`（长闭眼）。
- 若 `MIN_BLINK_DURATION_MS <= duration < CLOSED_EYES_TIME`，记录一次合法眨眼。

冷却控制：同类提示之间至少间隔 `EYE_ALERT_COOLDOWN_MS = 2000ms`。

其中 `MIN_BLINK_DURATION_MS = 60ms`，用于过滤抖动导致的极短伪闭眼。

### 6.4 Blink Rate（60 秒眨眼频率）

系统在每次合法眨眼发生时记录时间戳，并维护长度为 `BLINK_RATE_WINDOW_MS = 60000ms` 的滑动时间窗。

- 每帧清理窗口外时间戳。
- 当前窗口内时间戳数量即 Blink Rate：

$$
BlinkRate_{60s}(t)=|\{\tau_i\mid t-60000\le\tau_i\le t\}|
$$

### 6.5 打哈欠判定（持续时长约束）

基础条件（使用平滑 MAR）：

$$
MAR_{smooth} > MAR\_THRESHOLD
$$

其中 `MAR_THRESHOLD = 0.4`。

为降低说话、大笑、唱歌造成的瞬时误报，增加持续时长约束：

- 当 `MAR_smooth` 首次超阈值，记录张口开始时间。
- 仅当连续超阈值时长 `>= YAWN_MIN_DURATION_MS` 才判定打哈欠。
- 同一次持续张口过程最多触发一次告警。
- 嘴部回落到阈值以下后，重置本次打哈欠状态。

满足持续时长与冷却约束后：

- 触发“检测到打哈欠”提示
- 记录事件 `b`（值为当前 MAR）

冷却时间：`YAWN_ALERT_COOLDOWN_MS = 3000ms`。

最小时长：`YAWN_MIN_DURATION_MS = 1500ms`。

### 6.6 头部大幅移动判定

使用相邻帧鼻尖位移并做空间归一化：

- 鼻尖位移：

$$
d_{nose}=\sqrt{(x_{nose,t}-x_{nose,t-1})^2+(y_{nose,t}-y_{nose,t-1})^2}
$$

- 面部比例尺（双眼外眼角距离，关键点 33 与 263）：

$$
d_{eye}=\sqrt{(x_{33}-x_{263})^2+(y_{33}-y_{263})^2}
$$

- 头部相对移动比率：

$$
r=\frac{d_{nose}}{d_{eye}}
$$

判定规则：

- 若 `r > HEAD_MOVE_THRESHOLD (0.05)` 且超过冷却时间，则触发提示并记录事件 `c`。

冷却时间：`HEAD_MOVE_ALERT_COOLDOWN_MS = 2000ms`。

## 7. PERCLOS 与 Blink Rate 统计

定义：统计窗口内闭眼帧占比。

窗口参数：`PERCLOS_EPOCH_MS = 60000ms`。

PERCLOS 使用 60 秒滑动窗口逐帧更新（UI 更顺滑）：

- 每帧记录当前闭眼状态样本并剔除 60 秒外样本。
- 令窗口内样本总数为 $N$，闭眼样本数为 $N_c$，则：

$$
PERCLOS = \frac{N_c}{N}
$$

每 60 秒输出一次聚合记录：

- `PERCLOS`：60 秒闭眼帧占比
- `BlinkRate`：过去 60 秒合法眨眼次数

并将两者以同一时间戳写入同一条聚合记录用于导出。

## 8. 数据记录与导出约定

### 8.1 事件日志（离散）

字段：

- `timestamp`：ISO 时间戳
- `type`：`a|b|c`
- `value`：时长或幅值

事件语义：

- `a`：单次长闭眼（ms）
- `b`：打哈欠（MAR）
- `c`：头部大幅移动（归一化位移）

### 8.2 60 秒聚合序列（PERCLOS + Blink Rate）

字段：

- `timestamp`：ISO 时间戳
- `perclos`：60 秒窗口闭眼占比（0~1）
- `blinkRate`：60 秒窗口合法眨眼次数

## 9. 参数总表（当前实现）

| 参数名                      | 默认值 | 含义                             |
| --------------------------- | -----: | -------------------------------- |
| PROCESS_FPS                 |     20 | 标准化采集/处理帧率（FPS）       |
| PROCESS_INTERVAL_MS         |     50 | 算法处理帧间隔（ms）             |
| EAR_RATIO_THRESHOLD         |    0.6 | 个体基准 EAR 的闭眼比例阈值      |
| MAR_THRESHOLD               |    0.5 | 打哈欠判定阈值                   |
| CLOSED_EYES_TIME            |   1000 | 长闭眼最小时长（ms）             |
| MIN_BLINK_DURATION_MS       |     60 | 合法眨眼最小闭眼时长（ms）       |
| HEAD_MOVE_THRESHOLD         |   0.05 | 头部位移阈值                     |
| EYE_ALERT_COOLDOWN_MS       |   2000 | 长闭眼提示冷却（ms）             |
| YAWN_ALERT_COOLDOWN_MS      |   3000 | 打哈欠提示冷却（ms）             |
| YAWN_MIN_DURATION_MS        |   1500 | 打哈欠最小持续时长（ms）         |
| HEAD_MOVE_ALERT_COOLDOWN_MS |   2000 | 头部移动提示冷却（ms）           |
| CALIBRATION_DURATION_MS     |   5000 | 校准时长（ms）                   |
| CALIBRATION_MIN_SAMPLES     |      5 | 校准最小采样数                   |
| PERCLOS_EPOCH_MS            |  60000 | PERCLOS/BlinkRate 统计窗口（ms） |
| BLINK_RATE_WINDOW_MS        |  60000 | Blink Rate 统计窗口（ms）        |
| EAR_SMOOTH_WINDOW_SIZE      |      5 | EAR 滑动平均窗口（帧）           |
| MAR_SMOOTH_WINDOW_SIZE      |      5 | MAR 滑动平均窗口（帧）           |

## 10. 异常与边界处理

- 未检测到人脸：指标显示为占位值，不记录事件。
- 仅检测第一张脸：多人场景下可能忽略其他人状态。
- 若摄像头启动失败：UI 回退至未启动状态并提示错误。
- 冷却机制避免同类事件在短时间高频刷屏。
