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

// 触发浏览器下载 CSV 文件。
export function downloadCSV(csvContent, filename) {
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
