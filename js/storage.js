import { downloadCSV } from './utils.js';

// 管理会话期数据记录与 CSV 导出。
export function createStorage() {
    // 本次检测启动时间。
    let sessionStartTime = null;
    // 日志记录开始时间（校准完成时刻）。
    let loggingStartTime = null;
    // 日志记录结束时间（停止检测完成时刻）。
    let loggingEndTime = null;
    // 事件记录：长闭眼/哈欠/头动。
    let recordedEvents = [];
    // 60 秒聚合记录：PERCLOS + BlinkRate。
    let perclosBlinkRateData = [];

    // 统一格式化为北京时间。
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

        const ms = String(date.getMilliseconds()).padStart(3, '0');
        return `${partMap.year}-${partMap.month}-${partMap.day} ${partMap.hour}:${partMap.minute}:${partMap.second}.${ms}`;
    }

    // 防止表格软件自动改写时间格式，按文本导出。
    function toCsvText(value) {
        return `'${value}`;
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
        loggingStartTime = null;
        loggingEndTime = null;
        recordedEvents = [];
        perclosBlinkRateData = [];
    }

    // 标记日志记录开始时间（校准完成）。
    function markLoggingStart(time = new Date()) {
        if (!loggingStartTime) {
            loggingStartTime = new Date(time);
        }
    }

    // 标记日志记录结束时间（停止检测完成）。
    function markLoggingEnd(time = new Date()) {
        loggingEndTime = new Date(time);
    }

    // 记录一次离散事件。
    function recordEvent(type, value) {
        if (!loggingStartTime) {
            return;
        }

        recordedEvents.push({
            timestamp: toCsvText(formatBeijingTimestamp()),
            type,
            value
        });
    }

    // 记录一个 60 秒聚合样本（PERCLOS + BlinkRate）。
    function recordPerclosBlinkRate(perclos, blinkRate) {
        if (!loggingStartTime) {
            return;
        }

        perclosBlinkRateData.push({
            timestamp: toCsvText(formatBeijingTimestamp()),
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

        const startStr = loggingStartTime ? toCsvText(formatBeijingTimestamp(loggingStartTime)) : '未知';
        const endStr = loggingEndTime ? toCsvText(formatBeijingTimestamp(loggingEndTime)) : '未停止';
        const fileTime = formatBeijingFilenameTime(sessionStartTime || new Date());

        let csv = 'data:text/csv;charset=utf-8,\uFEFF';
        csv += `日志开始时间(校准完成):,${startStr}\n`;
        csv += `日志结束时间(停止检测):,${endStr}\n`;
        csv += '事件日志,,,,,60秒聚合指标,,\n';
        csv += '时间戳,事件类型,事件代号,数值详情(ms/幅度),,时间戳,60秒内闭眼占比(PERCLOS),60秒内眨眼次数(BlinkRate)\n';

        const rowCount = Math.max(recordedEvents.length, perclosBlinkRateData.length);
        for (let i = 0; i < rowCount; i += 1) {
            const e = recordedEvents[i];
            const m = perclosBlinkRateData[i];

            let eventCols = ',,,';
            if (e) {
                let eventName = '';
                switch (e.type) {
                    case 'a': eventName = '单次长闭眼(时长ms)'; break;
                    case 'b': eventName = '打哈欠(MAR)'; break;
                    case 'c': eventName = '头部大幅度移动(位移)'; break;
                }
                eventCols = `${e.timestamp},${eventName},${e.type},${e.value}`;
            }

            let metricCols = ',,';
            if (m) {
                metricCols = `${m.timestamp},${m.perclos.toFixed(4)},${m.blinkRate}`;
            }

            csv += `${eventCols},,${metricCols}\n`;
        }

        downloadCSV(csv, `${fileTime}_summary.csv`);

        return true;
    }

    return {
        startSession,
        markLoggingStart,
        markLoggingEnd,
        recordEvent,
        recordPerclosBlinkRate,
        hasData,
        exportAll
    };
}
