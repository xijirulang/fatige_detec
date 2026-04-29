import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// 计算二维坐标点之间的欧氏距离。
export function calculateDistance(p1, p2) {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// 计算眼睛纵横比（EAR），用于判断闭眼状态。
export function calculateEAR(landmarks, eyeIndices) {
    const p1 = landmarks[eyeIndices[0]]; const p2 = landmarks[eyeIndices[1]];
    const p3 = landmarks[eyeIndices[2]]; const p4 = landmarks[eyeIndices[3]];
    const p5 = landmarks[eyeIndices[4]]; const p6 = landmarks[eyeIndices[5]];
    const v1 = calculateDistance(p2, p6);
    const v2 = calculateDistance(p3, p5);
    const h = calculateDistance(p1, p4);
    return (v1 + v2) / (2.0 * h);
}

// 计算嘴部纵横比（MAR），用于判断打哈欠。
export function calculateMAR(landmarks) {
    const topLip = landmarks[13]; const bottomLip = landmarks[14];
    const leftCorner = landmarks[78]; const rightCorner = landmarks[308];
    const v = calculateDistance(topLip, bottomLip);
    const h = calculateDistance(leftCorner, rightCorner);
    return v / h;
}

// 获取当前本地时间字符串，用于日志显示。
export function getNowTimeText() {
    return new Date().toLocaleTimeString();
}

// 触发浏览器下载文本文件。
export function downloadTextFile(textContent, filename, mimeType = 'text/plain;charset=utf-8') {
    const blobParts = Array.isArray(textContent) ? textContent : [textContent];
    const blob = new Blob(blobParts, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// 判断是否运行在 Capacitor Android 原生容器内。
function isNativeAndroid() {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

// 将 UTF-8 字符串转为 Base64，供 Filesystem.writeFile 使用。
function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    const chunkSize = 0x8000;
    let binary = '';

    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
}

// 请求摄像头权限，供 getUserMedia 在 Android WebView 中稳定工作。
export async function requestCameraAccessPermission() {
    if (!isNativeAndroid()) {
        return { granted: true };
    }

    const checked = await Camera.checkPermissions();
    if (checked.camera === 'granted' || checked.camera === 'limited') {
        return { granted: true };
    }

    const requested = await Camera.requestPermissions({ permissions: ['camera'] });
    const granted = requested.camera === 'granted' || requested.camera === 'limited';

    return { granted };
}

// 请求公共存储权限（旧版 Android 需要）。
async function requestStoragePermissionIfNeeded() {
    if (!isNativeAndroid()) {
        return true;
    }

    try {
        const status = await Filesystem.checkPermissions();
        if (status.publicStorage === 'granted') {
            return true;
        }

        const requested = await Filesystem.requestPermissions();
        return requested.publicStorage === 'granted';
    } catch {
        // Android 10+ 常见场景不再需要该权限，异常时继续走应用目录导出。
        return true;
    }
}

// 触发 Android 原生导出：写入 Documents/FatigueDetection 并弹出分享面板。
async function exportTextWithCapacitor(textContent, filename) {
    const plainText = Array.isArray(textContent) ? textContent.join('') : String(textContent);
    await requestStoragePermissionIfNeeded();

    const folderPath = 'FatigueDetection';
    const filePath = `${folderPath}/${filename}`;

    try {
        await Filesystem.mkdir({
            directory: Directory.Documents,
            path: folderPath,
            recursive: true
        });
    } catch {
        // 已存在目录时忽略。
    }

    await Filesystem.writeFile({
        directory: Directory.Documents,
        path: filePath,
        data: utf8ToBase64(plainText),
        recursive: true
    });

    const fileUriResult = await Filesystem.getUri({
        directory: Directory.Documents,
        path: filePath
    });

    const canShareResult = await Share.canShare();
    if (canShareResult.value) {
        await Share.share({
            title: '导出疲劳检测数据',
            text: 'JSONL 导出文件',
            url: fileUriResult.uri,
            dialogTitle: '选择保存或分享方式'
        });
    }

    return fileUriResult.uri;
}

// 触发浏览器下载 JSON Lines 文件。
export async function downloadJSONL(linesText, filename) {
    if (isNativeAndroid()) {
        return exportTextWithCapacitor(linesText, filename);
    }

    downloadTextFile(linesText, filename, 'application/x-ndjson;charset=utf-8');
    return null;
}
