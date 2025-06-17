import PIDController from './pid-controller.js';
import { Client, Context } from './interfaces.js';
import { isPromAvailable } from './helpers.js';

import * as fs from 'node:fs';

export async function worker(context: Context) {
    const events = context.apis.foundation.getSystemEvents();
    const { logger } = context;
    const { _nodeName, terafoundation, terasliceJobSettingsController: controllerConfig } = context.sysconfig;
    const TARGET_RATE_BYTES_PER_SEC = controllerConfig.target_rate * 1024 * 1024;
    const TARGET_BYTES_PER_WINDOW = TARGET_RATE_BYTES_PER_SEC * (controllerConfig.window_ms / 1000);
    const PERCENT_MIN = controllerConfig.minimum_percent / 100;
    const PERCENT_MAX = 1;

    logger.info('Teraslice Job Settings Controller Config:\n', controllerConfig);
    logger.debug('TARGET_RATE_BYTES_PER_SEC: ', TARGET_RATE_BYTES_PER_SEC);
    logger.info('TARGET_BYTES_PER_WINDOW: ', TARGET_BYTES_PER_WINDOW);
    
    let decimalPercentage = controllerConfig.initial_percent_kept / 100;
    let indexBytes = 0;
    let retrievalErrorCount = 0;
    let retrievalFailed: boolean;
    let intervals = 0;
    let deltaBytes: number;

    // prometheus metrics setup
    await _setupPromMetrics();

    // PID controller setup
    const ADJUSTMENT_MIN = -0.25;
    const ADJUSTMENT_MAX = .25;
    const pid = new PIDController(context, ADJUSTMENT_MIN, ADJUSTMENT_MAX, controllerConfig.pid_constants);
    pid.initialize();

    // Elasticsearch client setup
    let sampleIndex = _buildSampleIndexString();
    let esClientSample: Client;
    let esClientStore: Client;
    esClientSample = (await context.apis.foundation.createClient({ type: 'elasticsearch-next', endpoint: controllerConfig.connections.sample.connector })).client;
    esClientStore = (await context.apis.foundation.createClient({ type: 'elasticsearch-next', endpoint: controllerConfig.connections.store.connector })).client;

    // Logging setup
    let logStream: fs.WriteStream;
    _setupLogs();
    
    // Set initial values
    indexBytes = await _getIndexSize();
    _updateStoreDocument(controllerConfig.initial_percent_kept)

    /**
     * Every window_ms, get the size of the sample index, calculate
     * the change in size, then calculate a new percentage
     */
    const updatePercentKeptInterval: NodeJS.Timeout = setInterval(async () => {
        intervals++;
        sampleIndex = _updateSampleIndex();
        logger.debug('Sample Index: ', sampleIndex);

        logger.debug('Index bytes previous read: ', indexBytes);
        const newIndexBytes = await _getIndexSize();
        logger.debug('Index bytes this read: ', newIndexBytes);

        const bytesSinceLastRead = newIndexBytes - indexBytes;
        logger.debug('Difference in bytes since last read: ', bytesSinceLastRead);
        
        indexBytes = newIndexBytes;

        // skip percentage calculation if index size could not be retrieved
        if (retrievalFailed) {
            // count successive failures so we can properly calculate
            // the error once retrieval is successful
            retrievalErrorCount++;
            logger.info('Unable to retrieve index size, skipping percentage update this window.');
            return;
        }
        decimalPercentage = _calculatePercentage(bytesSinceLastRead, decimalPercentage);
        retrievalErrorCount = 0;
    }, controllerConfig.window_ms);

    /**
     * Get the size of the sample index, or return the previous
     * index size if the request fails.
     * @returns { Promise<number> } Size in bytes of the sample index
     */
    async function _getIndexSize(): Promise<number> {
        retrievalFailed = false;
        try {
            const indexInfo = await esClientSample.cat.indices({
                index: sampleIndex,
                bytes: 'b',
                format: 'json'
            });
            let size: number;
            const sizeStr: string | undefined = indexInfo[0]['store.size'];
            if (!sizeStr) {
                throw new Error('store.size is undefined');
            }
            size = Number(sizeStr)
            return size;
        } catch (err) {
            retrievalFailed = true;
            logger.warn(`Error retrieving index size: ${err}`);
            return indexBytes;
        }
    }

    /**
     * Calculate the percentage of records to keep during the next window 
     * @param { number } bytesSinceLastRead number of bytes added to the index since the
     *                                      last successful read 
     * @param { number } previousPercentage the percentage calculated from the previous
     *                                      window or the initial percentage
     * @returns { number } Percentage of records to keep
     */
    function _calculatePercentage(bytesSinceLastRead: number, previousPercentage: number) {
        const totalTimeSecs = intervals * controllerConfig.window_ms / 1000;
        const indexMB = indexBytes / (1024 * 1024);
        const avgRateMBPerSec = indexMB / totalTimeSecs

        const windowsSinceLastUpdate = retrievalErrorCount + 1
        const averageBytesSinceLastUpdate = bytesSinceLastRead / windowsSinceLastUpdate;
        setDeltaBytes(averageBytesSinceLastUpdate);
        logger.debug('deltaBytes: ', deltaBytes);

        const errorBytesDelta = deltaBytes - TARGET_BYTES_PER_WINDOW; 
        const errorPctDelta = errorBytesDelta / TARGET_BYTES_PER_WINDOW;
        const adjustment = pid.update(errorPctDelta);
        const newPercentage = previousPercentage - adjustment;
        logData(previousPercentage, errorPctDelta, bytesSinceLastRead, deltaBytes, avgRateMBPerSec);

        // clamp percentKept between MIN and MAX
        const clampedPercentage = Math.max(PERCENT_MIN, Math.min(PERCENT_MAX, newPercentage));

        logger.debug({
            totalTimeSecs,
            avgRateMBPerSec,
            windowsSinceLastUpdate,
            errorBytesDelta,
            errorPctDelta,
            adjustment,
            newPercentage,
            clampedPercentage
        })

        const percent = clampedPercentage * 100;

        _updateStoreDocument(percent);

        logger.info(`Target: ${Math.round(TARGET_BYTES_PER_WINDOW)} bytes, Actual: ${bytesSinceLastRead} bytes, Delta: ${deltaBytes} bytes, Sample Rate: ${percent.toFixed(3)} percent`);
        
        if (isPromAvailable(context)) {
            context.apis.foundation.promMetrics.set('index_MB', {}, indexMB);
            context.apis.foundation.promMetrics.set('bytes_per_window', {}, bytesSinceLastRead);
            context.apis.foundation.promMetrics.set('retrieval_error_count', {}, retrievalErrorCount);
            context.apis.foundation.promMetrics.set('percent', {}, percent);
            context.apis.foundation.promMetrics.set('average_rate', {}, avgRateMBPerSec);
            context.apis.foundation.promMetrics.set('delta_bytes', {}, deltaBytes);
            context.apis.foundation.promMetrics.set('PID_controller_adjustment', {}, adjustment);
        }
        return clampedPercentage;
    }

    function _setupLogs() {
        // fixme don't overwrite logs
        const logFilePath = '/app/logs/sample-log.csv';

        try {
            fs.writeFileSync(logFilePath, '')
        } catch (err) {
            logger.error('writeFileSync err: ', err);
        }
        try {
            logStream = fs.createWriteStream(logFilePath);
            logStream.write('timestamp,percentKept,errorPctDelta,bytesThisWindow,deltaBytes,avgRateMBPerSec\n');
        } catch (err) {
            logger.error(`Failed to create log stream. Err: ${err}`);
        }
    }

    function logData(percentage: number, errorPctDelta: number, bytes: number, deltaBytes: number, avgRate: number) {
        if (logStream) {
            const timestamp = new Date().toISOString();
            logStream.write(`${timestamp},${percentage.toFixed(4)},${errorPctDelta.toFixed(4)},${bytes},${deltaBytes},${avgRate.toFixed(4)}\n`);
        }
    }

    /**
     * @param { Date } date The Date object to be parsed
     * @returns { string[] } Array containing the year, month, and day
     */
    function _parseDate(date: Date): string[] {
        return date.toISOString()
            .slice(0, 11)
            .split(/[-T\s]/);
    }

    /**
     * Build the sample index string from the daily_index_prefix, delimiter, and system date
     * @returns { string } Current index to sample
     */
    function _buildSampleIndexString(): string {
        const { daily_index_prefix: pre, date_delimiter: del } = controllerConfig.connections.sample;
        const [year, month, day] = _parseDate(new Date());
        return `${pre}-${year}${del}${month}${del}${day}`;
    }

    /**
     * Calculate the sample index and reset indexBytes to
     * zero if the sample index has changed
     * @returns { string } sample index string
     */
    function _updateSampleIndex(): string {
        const newIndex = _buildSampleIndexString();
        if (newIndex !== sampleIndex) {
            indexBytes = 0;
            intervals = 0;
        }
        if (isPromAvailable(context)) {
            context.apis.foundation.promMetrics.set('sample_index', { sample_index: newIndex }, 1);
        }
        return newIndex;
    }

    /**
     * Updates the document on the store connection with a new percent.
     * @param percent New calculated percent to store
     */
    function _updateStoreDocument(percent: number) {
        const { document_id: id, index } = controllerConfig.connections.store;
        try{
            esClientStore.update({
                id,
                index,
                body: {
                    doc: {
                        percent,
                        index: sampleIndex,
                        updated: Date.now()
                    },
                    doc_as_upsert: true
                }
            });
        } catch (err) {
            logger.warn(`Error updating document with id ${id}: ${err}`);
        }
    }

    /**
     * Calculates the exponential moving average change in index size
     * @param newDelta change in index size since last read
     * @param alpha Smoothing factor between 0 and 1. Controls how fast the average reacts.
     */
    function setDeltaBytes(newDelta: number, alpha = 0.2) {
        if (!deltaBytes) {
            deltaBytes = newDelta;
        } else {
            deltaBytes = Math.round(alpha * newDelta + (1 - alpha) * deltaBytes);
        }
    }

    async function _setupPromMetrics() {
        const nodeName = _nodeName.split('.');
        const workerId = nodeName.pop();
        await context.apis.foundation.promMetrics.init({
            terasliceName: controllerConfig.cluster,
            tf_prom_metrics_add_default: terafoundation.prom_metrics_add_default,
            tf_prom_metrics_enabled: terafoundation.prom_metrics_enabled,
            tf_prom_metrics_port: terafoundation.prom_metrics_port,
            logger,
            assignment: 'worker',
            prefix: 'teraslice_job_settings_controller_',
            prom_metrics_display_url: terafoundation.prom_metrics_display_url,
            labels: {
                cluster: controllerConfig.cluster,
                service: 'teraslice_job_settings_controller',
                node: _nodeName,
                worker: workerId ?? '',
            }
        });

        if (isPromAvailable(context)) {
            await context.apis.foundation.promMetrics.addGauge(
                'controller_info',
                'Information about Teraslice Job Settings Controller',
                ['target_rate', 'window_ms', 'target_bytes_per_window', 'pid_constants', 'daily_index_prefix', 'date_delimiter']
            );

            await context.apis.foundation.promMetrics.addGauge(
                'sample_index',
                'The current daily index being tracked for index size',
                ['sample_index']
            );

            await context.apis.foundation.promMetrics.addGauge(
                'index_MB',
                'The most current measurement of the sample index size (in MB)',
                []
            );

            await context.apis.foundation.promMetrics.addGauge(
                'bytes_per_window',
                'The change in index size between windows (in bytes)',
                []
            );

            await context.apis.foundation.promMetrics.addGauge(
                'retrieval_error_count',
                'Number of consecutive failed attempts to retrieve the sample index size',
                []
            );

            await context.apis.foundation.promMetrics.addGauge(
                'percent',
                'Current percent of records to sample',
                []
            );

            await context.apis.foundation.promMetrics.addGauge(
                'average_rate',
                'Average rate of index growth (MB/sec)',
                []
            );

            await context.apis.foundation.promMetrics.addGauge(
                'delta_bytes',
                'The exponential moving average of bytes_per_window',
                []
            );

            await context.apis.foundation.promMetrics.addGauge(
                'PID_controller_adjustment',
                'Adjustment to the percent calculated by the PID controller',
                []
            );

            context.apis.foundation.promMetrics.set(
                'controller_info',
                {
                    target_rate: controllerConfig.target_rate.toString(),
                    window_ms: controllerConfig.window_ms.toString(),
                    target_bytes_per_window: TARGET_BYTES_PER_WINDOW.toString(),
                    pid_constants: controllerConfig.pid_constants.toString(),
                    daily_index_prefix: controllerConfig.connections.sample.daily_index_prefix,
                    date_delimiter: controllerConfig.connections.sample.date_delimiter
                },
                1
            );
        }
    }

    /**
     * Listens for a terafoundation shutdown event.
     * Clears interval and exits.
     */
    events.once('terafoundation:shutdown', () => {
        logger.debug('received shutdown notice from terafoundation');
        clearInterval(updatePercentKeptInterval);
        process.exit(0);
    });
}