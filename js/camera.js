import { PROCESS_INTERVAL_MS } from './config.js';

// 创建摄像头与 FaceMesh 的生命周期控制器。
export function createCameraController({ videoElement, onResults }) {
    // 摄像头实例。
    let camera = null;
    // MediaPipe FaceMesh 实例。
    let faceMesh = null;
    // 上一帧处理时间戳（用于降频）。
    let lastProcessTime = 0;
    // 本地 MediaPipe 资源根路径。
    const mediapipeBasePath = `${import.meta.env.BASE_URL}vendor/mediapipe`;

    // 判断摄像头与模型是否已完成初始化。
    function isInitialized() {
        return !!(camera && faceMesh);
    }

    // 按需初始化 FaceMesh 与 Camera，避免重复创建。
    async function ensureInitialized() {
        if (isInitialized()) return;

        faceMesh = new window.FaceMesh({
            locateFile: (file) => {
                return `${mediapipeBasePath}/${file}`;
            }
        });

        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        faceMesh.onResults(onResults);

        camera = new window.Camera(videoElement, {
            onFrame: async () => {
                // 按设定间隔送帧，减少发热和算力开销。
                const now = Date.now();
                if (now - lastProcessTime >= PROCESS_INTERVAL_MS) {
                    lastProcessTime = now;
                    await faceMesh.send({ image: videoElement });
                }
            },
            facingMode: 'user'
        });
    }

    // 启动摄像头采集。
    async function start() {
        await ensureInitialized();
        await camera.start();
    }

    // 停止摄像头采集。
    async function stop() {
        if (camera) {
            await camera.stop();
        }
    }

    return {
        isInitialized,
        ensureInitialized,
        start,
        stop
    };
}
