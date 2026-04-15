# fatigue-detection

基于浏览器摄像头 + MediaPipe Face Mesh 的疲劳检测项目，支持：

- EAR（闭眼比）动态校准与实时检测
- MAR（哈欠比）检测
- 头部大幅移动检测
- 每 5 秒周期 PERCLOS（闭眼占比）记录
- CSV 日志导出（事件日志、PERCLOS 连续记录）

## 项目结构

```text
fatigue-detection/
├── index.html          # 页面结构
├── css/
│   └── style.css       # 所有样式
├── js/
│   ├── main.js         # 入口：启动流程与按钮绑定
│   ├── config.js       # 常量、阈值、配置
│   ├── dom.js          # DOM 元素统一获取
│   ├── camera.js       # 摄像头 + MediaPipe 初始化
│   ├── detector.js     # 核心算法：EAR / MAR / PERCLOS / 闭眼检测
│   ├── ui.js           # UI 更新：日志、提醒、状态与颜色
│   ├── utils.js        # 工具函数：计算、下载、时间
│   └── storage.js      # 数据记录 + CSV 导出
├── assets/             # 图片/图标（可选）
├── package.json        # 项目配置（本地运行、打包）
└── README.md           # 说明文档
```

## 本地运行

1. 安装依赖

```bash
npm install
```

2. 启动开发服务器

```bash
npm run dev
```

3. 在浏览器中打开命令行显示的本地地址（通常是 http://localhost:5173）

## 打包构建

```bash
npm run build
```

构建产物会输出到 `dist/` 目录。

## 预览构建结果

```bash
npm run preview
```

## 使用说明

1. 打开页面后点击“启动摄像头开始检测”。
2. 按提示保持正常睁眼约 2 秒完成校准。
3. 系统会持续输出疲劳相关日志和实时指标。
4. 点击“导出日志”可下载 CSV 数据。

## 注意事项

- 需要使用支持摄像头访问的浏览器。
- 建议在 HTTPS 或 localhost 环境下运行。
- 首次运行会请求摄像头权限和可能的屏幕常亮权限。
