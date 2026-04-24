import {
    DATA_PRUNE_INTERVAL_MS,
    DATA_RETENTION_HOURS
} from './config.js';
import { downloadJSONL } from './utils.js';

const JSONL_SCHEMA_VERSION = '2.0.0';
const JSONL_SOURCE_VERSION = import.meta.env?.VITE_APP_VERSION || '1.0.0';
const JSONL_BUILD_TIME = import.meta.env?.VITE_BUILD_TIME || null;
const EXPORT_CHUNK_LINE_COUNT = 500;

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

    // 统一浮点定点化，避免导出长尾小数。
    function roundTo(value, digits = 4) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return value;
        }

        return Number(value.toFixed(digits));
    }

    // 按时间有序数组做头部裁剪，避免全量 filter。
    function pruneByCutoff(records, cutoffMs) {
        if (records.length === 0 || records[0].timestampMs >= cutoffMs) {
            return records;
        }

        let firstValidIndex = 0;
        while (firstValidIndex < records.length && records[firstValidIndex].timestampMs < cutoffMs) {
            firstValidIndex += 1;
        }

        if (firstValidIndex === 0) {
            return records;
        }

        return records.slice(firstValidIndex);
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

        recordedEvents = pruneByCutoff(recordedEvents, cutoffMs);
        perclosBlinkRateData = pruneByCutoff(perclosBlinkRateData, cutoffMs);
        perSecondSamples = pruneByCutoff(perSecondSamples, cutoffMs);
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
        perSecondSamples.push({
            timestampMs,
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

        const blobParts = [];
        let chunkLines = [];

        function pushLine(record) {
            chunkLines.push(JSON.stringify(record));
            if (chunkLines.length >= EXPORT_CHUNK_LINE_COUNT) {
                blobParts.push(`${chunkLines.join('\n')}\n`);
                chunkLines = [];
            }
        }

        function flushChunk() {
            if (chunkLines.length === 0) {
                return;
            }
            blobParts.push(`${chunkLines.join('\n')}\n`);
            chunkLines = [];
        }

        const exportedAt = formatBeijingTimestamp();
        pushLine({
            type: 'session',
            schemaVersion: JSONL_SCHEMA_VERSION,
            sourceVersion: JSONL_SOURCE_VERSION,
            buildTime: JSONL_BUILD_TIME,
            sessionStartTime: sessionStartTime ? formatBeijingTimestamp(sessionStartTime) : null,
            loggingStartTime: startStr,
            loggingEndTime: endStr,
            exportedAt,
            retentionHours: DATA_RETENTION_HOURS,
            counters: {
                events: recordedEvents.length,
                perSecondSamples: perSecondSamples.length,
                perclosEpochs: perclosBlinkRateData.length
            }
        });

        let eventIndex = 0;
        let secondIndex = 0;
        let minuteIndex = 0;

        while (
            eventIndex < recordedEvents.length
            || secondIndex < perSecondSamples.length
            || minuteIndex < perclosBlinkRateData.length
        ) {
            const nextEvent = eventIndex < recordedEvents.length ? recordedEvents[eventIndex] : null;
            const nextSecond = secondIndex < perSecondSamples.length ? perSecondSamples[secondIndex] : null;
            const nextMinute = minuteIndex < perclosBlinkRateData.length ? perclosBlinkRateData[minuteIndex] : null;

            const eventTs = nextEvent ? nextEvent.timestampMs : Number.POSITIVE_INFINITY;
            const secondTs = nextSecond ? nextSecond.timestampMs : Number.POSITIVE_INFINITY;
            const minuteTs = nextMinute ? nextMinute.timestampMs : Number.POSITIVE_INFINITY;

            if (eventTs <= secondTs && eventTs <= minuteTs) {
                pushLine({
                    timestampMs: nextEvent.timestampMs,
                    type: 'event',
                    timestamp: nextEvent.timestamp,
                    eventType: nextEvent.type,
                    value: nextEvent.value
                });
                eventIndex += 1;
                continue;
            }

            if (secondTs <= eventTs && secondTs <= minuteTs) {
                pushLine({
                    timestampMs: nextSecond.timestampMs,
                    type: 'perSecond',
                    earAvg: roundTo(nextSecond.earAvg, 4),
                    marAvg: roundTo(nextSecond.marAvg, 4),
                    closedRatio: roundTo(nextSecond.closedRatio, 4),
                    blinkDelta: nextSecond.blinkDelta,
                    headMovePeak: roundTo(nextSecond.headMovePeak, 4),
                    headMoveAvg: roundTo(nextSecond.headMoveAvg, 4),
                    perclos: roundTo(nextSecond.perclos, 4),
                    blinkRate: nextSecond.blinkRate,
                    eyeAlerts: nextSecond.eyeAlerts,
                    yawnAlerts: nextSecond.yawnAlerts,
                    headMoveAlerts: nextSecond.headMoveAlerts
                });
                secondIndex += 1;
                continue;
            }

            pushLine({
                timestampMs: nextMinute.timestampMs,
                type: 'perclosMinute',
                timestamp: nextMinute.timestamp,
                perclos: roundTo(nextMinute.perclos, 4),
                blinkRate: nextMinute.blinkRate
            });
            minuteIndex += 1;
        }

        pushLine({
            type: 'sessionEnd',
            loggingEndTime: endStr,
            exportedAt
        });

        flushChunk();
        downloadJSONL(blobParts, `${fileTime}_summary.jsonl`);

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
