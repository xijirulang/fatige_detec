import {
    DATA_PRUNE_INTERVAL_MS,
    DATA_RETENTION_HOURS
} from './config.js';
import { downloadJSONL } from './utils.js';

// 管理会话期数据记录与 JSONL 导出。
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
    // 每秒关键指标记录。
    let perSecondSamples = [];
    // 上次执行滚动裁剪时间。
    let lastPruneTime = 0;

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

    // 统一构建带双时间戳的记录。
    function createTimestampEntry(timestampMs) {
        return {
            timestampMs,
            timestamp: formatBeijingTimestamp(new Date(timestampMs))
        };
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
        perSecondSamples = [];
        lastPruneTime = 0;
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
    function maybePrune(nowMs) {
        if (lastPruneTime !== 0 && (nowMs - lastPruneTime) < DATA_PRUNE_INTERVAL_MS) {
            return;
        }

        const retentionWindowMs = DATA_RETENTION_HOURS * 60 * 60 * 1000;
        const cutoffMs = nowMs - retentionWindowMs;

        recordedEvents = recordedEvents.filter((item) => item.timestampMs >= cutoffMs);
        perclosBlinkRateData = perclosBlinkRateData.filter((item) => item.timestampMs >= cutoffMs);
        perSecondSamples = perSecondSamples.filter((item) => item.timestampMs >= cutoffMs);
        lastPruneTime = nowMs;
    }

    // 记录一次离散事件。
    function recordEvent(type, value, timestampMs = Date.now()) {
        if (!loggingStartTime) {
            return;
        }

        maybePrune(timestampMs);
        const base = createTimestampEntry(timestampMs);
        recordedEvents.push({
            ...base,
            type,
            value
        });
    }

    // 记录一个 60 秒聚合样本（PERCLOS + BlinkRate）。
    function recordPerclosBlinkRate(perclos, blinkRate, timestampMs = Date.now()) {
        if (!loggingStartTime) {
            return;
        }

        maybePrune(timestampMs);
        const base = createTimestampEntry(timestampMs);
        perclosBlinkRateData.push({
            ...base,
            perclos,
            blinkRate
        });
    }

    // 记录每秒关键指标样本。
    function recordPerSecondSample(sample, timestampMs = Date.now()) {
        if (!loggingStartTime) {
            return;
        }

        maybePrune(timestampMs);
        const base = createTimestampEntry(timestampMs);
        perSecondSamples.push({
            ...base,
            ...sample
        });
    }

    // 判断是否有可导出的数据。
    function hasData() {
        return recordedEvents.length > 0 || perclosBlinkRateData.length > 0 || perSecondSamples.length > 0;
    }

    // 导出为 JSON Lines（NDJSON），便于长时流式解析。
    function exportAll() {
        if (!hasData()) {
            return false;
        }

        const startStr = loggingStartTime ? formatBeijingTimestamp(loggingStartTime) : null;
        const endStr = loggingEndTime ? formatBeijingTimestamp(loggingEndTime) : null;
        const fileTime = formatBeijingFilenameTime(sessionStartTime || new Date());

        const lines = [];
        lines.push(JSON.stringify({
            type: 'session',
            sessionStartTime: sessionStartTime ? formatBeijingTimestamp(sessionStartTime) : null,
            loggingStartTime: startStr,
            loggingEndTime: endStr,
            exportedAt: formatBeijingTimestamp(),
            retentionHours: DATA_RETENTION_HOURS,
            counters: {
                events: recordedEvents.length,
                perSecondSamples: perSecondSamples.length,
                perclosEpochs: perclosBlinkRateData.length
            }
        }));

        recordedEvents.forEach((event) => {
            lines.push(JSON.stringify({
                type: 'event',
                timestampMs: event.timestampMs,
                timestamp: event.timestamp,
                eventType: event.type,
                value: event.value
            }));
        });

        perSecondSamples.forEach((sample) => {
            lines.push(JSON.stringify({
                type: 'perSecond',
                ...sample
            }));
        });

        perclosBlinkRateData.forEach((metric) => {
            lines.push(JSON.stringify({
                type: 'perclosMinute',
                timestampMs: metric.timestampMs,
                timestamp: metric.timestamp,
                perclos: metric.perclos,
                blinkRate: metric.blinkRate
            }));
        });

        lines.push(JSON.stringify({
            type: 'sessionEnd',
            loggingEndTime: endStr,
            exportedAt: formatBeijingTimestamp()
        }));

        downloadJSONL(`${lines.join('\n')}\n`, `${fileTime}_summary.jsonl`);

        return true;
    }

    return {
        startSession,
        markLoggingStart,
        markLoggingEnd,
        recordEvent,
        recordPerclosBlinkRate,
        recordPerSecondSample,
        hasData,
        exportAll
    };
}
