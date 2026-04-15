import { downloadCSV } from './utils.js';

// 管理会话期数据记录与 CSV 导出。
export function createStorage() {
    // 本次检测启动时间。
    let sessionStartTime = null;
    // 事件记录：长闭眼/哈欠/头动。
    let recordedEvents = [];
    // 60 秒聚合记录：PERCLOS + BlinkRate。
    let perclosBlinkRateData = [];

    // 统一格式化为北京时间（UTC+08:00）。
    function formatBeijingTimestamp(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).formatToParts(date);

        const partMap = {};
        parts.forEach((part) => {
            if (part.type !== 'literal') {
                partMap[part.type] = part.value;
            }
        });

        return `${partMap.year}-${partMap.month}-${partMap.day} ${partMap.hour}:${partMap.minute}:${partMap.second} UTC+08:00`;
    }

    // 生成用于文件名的北京时间（无特殊字符）。
    function formatBeijingFilenameTime(date = new Date()) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).formatToParts(date);

        const partMap = {};
        parts.forEach((part) => {
            if (part.type !== 'literal') {
                partMap[part.type] = part.value;
            }
        });

        return `${partMap.year}${partMap.month}${partMap.day}_${partMap.hour}${partMap.minute}${partMap.second}`;
    }

    // 开始新会话并清空历史记录。
    function startSession() {
        sessionStartTime = new Date();
        recordedEvents = [];
        perclosBlinkRateData = [];
    }

    // 记录一次离散事件。
    function recordEvent(type, value) {
        recordedEvents.push({
            timestamp: formatBeijingTimestamp(),
            type,
            value
        });
    }

    // 记录一个 60 秒聚合样本（PERCLOS + BlinkRate）。
    function recordPerclosBlinkRate(perclos, blinkRate) {
        perclosBlinkRateData.push({
            timestamp: formatBeijingTimestamp(),
            perclos,
            blinkRate
        });
    }

    // 判断是否有可导出的数据。
    function hasData() {
        return recordedEvents.length > 0 || perclosBlinkRateData.length > 0;
    }

    // 导出事件日志与 60 秒聚合指标两类 CSV 文件。
    function exportAll() {
        if (!hasData()) {
            return false;
        }

        const startStr = sessionStartTime ? formatBeijingTimestamp(sessionStartTime) : '未知';
        const exportStr = formatBeijingTimestamp();
        const fileTime = formatBeijingFilenameTime(sessionStartTime || new Date());

        if (recordedEvents.length > 0) {
            let csv1 = 'data:text/csv;charset=utf-8,\uFEFF';
            csv1 += `测试启动时间:,${startStr}\n`;
            csv1 += `数据执行导出时间:,${exportStr}\n`;
            csv1 += '时间戳,事件类型,事件代号,数值详情(ms/幅度)\n';

            recordedEvents.forEach((e) => {
                let eventName = '';
                switch (e.type) {
                    case 'a': eventName = '单次长闭眼(时长ms)'; break;
                    case 'b': eventName = '打哈欠(MAR)'; break;
                    case 'c': eventName = '头部大幅度移动(位移)'; break;
                }
                csv1 += `${e.timestamp},${eventName},${e.type},${e.value}\n`;
            });
            downloadCSV(csv1, `${fileTime}_events.csv`);
        }

        if (perclosBlinkRateData.length > 0) {
            let csv2 = 'data:text/csv;charset=utf-8,\uFEFF';
            csv2 += `测试启动时间:,${startStr}\n`;
            csv2 += `执行导出时间:,${exportStr}\n`;
            csv2 += '时间戳,60秒内闭眼占比(PERCLOS),60秒内眨眼次数(BlinkRate)\n';

            perclosBlinkRateData.forEach((m) => {
                csv2 += `${m.timestamp},${m.perclos.toFixed(4)},${m.blinkRate}\n`;
            });
            downloadCSV(csv2, `${fileTime}_eyes_trans.csv`);
        }

        return true;
    }

    return {
        startSession,
        recordEvent,
        recordPerclosBlinkRate,
        hasData,
        exportAll
    };
}
