import { downloadCSV } from './utils.js';

// 管理会话期数据记录与 CSV 导出。
export function createStorage() {
    // 本次检测启动时间。
    let sessionStartTime = null;
    // 事件记录：长闭眼/哈欠/头动。
    let recordedEvents = [];
    // 周期 PERCLOS 记录。
    let perclosData = [];

    // 开始新会话并清空历史记录。
    function startSession() {
        sessionStartTime = new Date();
        recordedEvents = [];
        perclosData = [];
    }

    // 记录一次离散事件。
    function recordEvent(type, value) {
        recordedEvents.push({
            timestamp: new Date().toISOString(),
            type,
            value
        });
    }

    // 记录一个 PERCLOS 周期样本。
    function recordPerclos(value) {
        perclosData.push({
            timestamp: new Date().toISOString(),
            value
        });
    }

    // 判断是否有可导出的数据。
    function hasData() {
        return recordedEvents.length > 0 || perclosData.length > 0;
    }

    // 导出事件日志与 PERCLOS 两类 CSV 文件。
    function exportAll() {
        if (!hasData()) {
            return false;
        }

        const startStr = sessionStartTime ? sessionStartTime.toLocaleString() : '未知';
        const exportStr = new Date().toLocaleString();
        const fileTime = sessionStartTime ? sessionStartTime.getTime() : new Date().getTime();

        if (recordedEvents.length > 0) {
            let csv1 = 'data:text/csv;charset=utf-8,\uFEFF';
            csv1 += `本次测试启动时间:,${startStr}\n`;
            csv1 += `数据执行导出时间:,${exportStr}\n`;
            csv1 += '设定降频FPS:,10帧/秒\n\n';
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
            downloadCSV(csv1, `fatigue_events_start_${fileTime}.csv`);
        }

        if (perclosData.length > 0) {
            let csv2 = 'data:text/csv;charset=utf-8,\uFEFF';
            csv2 += `本次测试启动时间:,${startStr}\n`;
            csv2 += `数据执行导出时间:,${exportStr}\n`;
            csv2 += '记录周期:,严格5秒平均\n\n';
            csv2 += '时间戳,5秒内闭眼占比(PERCLOS)\n';

            perclosData.forEach((p) => {
                csv2 += `${p.timestamp},${p.value.toFixed(4)}\n`;
            });
            downloadCSV(csv2, `fatigue_perclos_5s_start_${fileTime}.csv`);
        }

        return true;
    }

    return {
        startSession,
        recordEvent,
        recordPerclos,
        hasData,
        exportAll
    };
}
