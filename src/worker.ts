import { ESLikeClient as ES, Terafoundation as TF } from '@terascope/types';
import PIDController from './pid-controller.js';
import { Config } from './interfaces.js';

// fixme remove  ??
import * as fs from 'node:fs';

interface Client {
    get: (query: ES.GetParams, fullResponse?: boolean) => Promise<any>;
    cat: {
        indices: (params: ES.CatIndicesParams) => Promise<ES.CatIndicesResponse>;
    }
    update: (params: ES.UpdateParams) => Promise<ES.UpdateResponse>; 
}

export async function worker(context: TF.Context<Config>) {
    const { logger } = context;
    const config = context.sysconfig.terasliceJobSettingsController;
    console.log('@@@@ config: ', config);

    const TARGET_RATE_BYTES_PER_SEC = config.target_rate * 1024 * 1024;
    console.log('@@@@ TARGET_RATE_BYTES_PER_SEC: ', TARGET_RATE_BYTES_PER_SEC);
    const TARGET_BYTES_PER_WINDOW = TARGET_RATE_BYTES_PER_SEC
    * (config.window_ms / 1000);
    console.log('@@@@ TARGET_BYTES_PER_WINDOW: ', TARGET_BYTES_PER_WINDOW);
    const PERCENT_MIN = 0;
    const PERCENT_MAX = 1;
    const ADJUSTMENT_MIN = -0.5;
    const ADJUSTMENT_MAX = .5;

    let indexBytes = 0;
    let bytesSinceLastRead = 0;
    let retrievalFailed: boolean;
    let retrievalErrorCount = 0;
    let decimalPercentage = config.initial_percent_kept / 100;
    const pid = new PIDController(ADJUSTMENT_MIN, ADJUSTMENT_MAX, ...config.pid_constants);
    let esClientSample: Client;
    let esClientStore: Client;

    let logStream: fs.WriteStream;

    // fixme don't overwrite logs
    const logFilePath = '/app/logs/sample-log.csv';

    try {
        fs.writeFileSync(logFilePath, '')
    } catch (err) {
        console.log('@@@@ writeFileSync err: ', err);
    }
    try {
        logStream = fs.createWriteStream(logFilePath);
        logStream.write('timestamp,percentKept,errorPct,bytesThisWindow\n');
    } catch (err) {
        console.log('@@@@ logStream err: ', err);
        throw new Error(`Failed to create log stream. Err: ${err}`);
    }

    esClientSample = (await context.apis.foundation.createClient({ type: 'elasticsearch-next', endpoint: config.connections.sample.connector })).client;
    esClientStore = (await context.apis.foundation.createClient({ type: 'elasticsearch-next', endpoint: config.connections.store.connector })).client;

    indexBytes = await getIndexSize();

    const updatePercentKeptInterval: NodeJS.Timeout = setInterval(async () => {
        console.log('@@@@ indexBytes before: ', indexBytes);
        const newIndexBytes = await getIndexSize();
        console.log('@@@@ newIndexBytes: ', newIndexBytes);
        bytesSinceLastRead = newIndexBytes - indexBytes;
        console.log('@@@@ bytesSinceLastRead: ', bytesSinceLastRead);
        indexBytes = newIndexBytes;
        console.log('@@@@ indexBytes after: ', indexBytes);

        if (retrievalFailed) {
            retrievalErrorCount++;
            logger.info('Unable to retrieve index size, skipping percentage update this window.');
            return;
        }
        _updatePercentKept();
    }, config.window_ms);

    async function getIndexSize(): Promise<number> {
        retrievalFailed = false;
        try {
            const indexInfo = await esClientSample.cat.indices({
                index: config.connections.sample.index,
                bytes: 'b',
                format: 'json'
            });
            console.log('@@@@ indexInfo: ', indexInfo);
            let size: number;
            const sizeStr: string | undefined = indexInfo[0]['store.size'];
            if (!sizeStr) {
                throw new Error('store.size is undefined');
            }
            size = Number(sizeStr)
            console.log('@@@@ size: ', size);

            return size;
        } catch (err) {
            retrievalFailed = true;
            logger.warn(`Error retrieving index size: ${err}`); // fixme better message
            return indexBytes; // fixme: are we sure about this?
        }
    }

    function _updatePercentKept() {
        const { document_id: id } = config.connections.store;
        const windowsSinceLastUpdate = retrievalErrorCount + 1
        console.log('@@@@ windowsSinceLastUpdate: ', windowsSinceLastUpdate);

        // fixme": instead pass in time since last update and have pid use dt in equation
        const errorBytes = TARGET_BYTES_PER_WINDOW - (bytesSinceLastRead / windowsSinceLastUpdate); 
        console.log('@@@@ errorBytes: ', errorBytes);

        const errorPct = errorBytes / TARGET_BYTES_PER_WINDOW;
        console.log('@@@@ errorPct: ', errorPct);

        const adjustment = pid.update(errorPct);
        console.log('@@@@ adjustment: ', adjustment);
        logData(decimalPercentage, errorPct, bytesSinceLastRead);

        decimalPercentage += adjustment;
        console.log('@@@@ decimalPercentage: ', decimalPercentage);

        // clamp percentKept between MIN and MAX
        decimalPercentage = Math.max(PERCENT_MIN, Math.min(PERCENT_MAX, decimalPercentage));
        console.log('@@@@ decimalPercentage Clamped: ', decimalPercentage);
        const percent = decimalPercentage * 100;

        try{
            esClientStore.update({
                id,
                index: config.connections.store.index,
                body: {
                    doc: {
                        percent,
                        index: config.connections.sample.index,
                        updated: Date.now()
                    },
                    doc_as_upsert: true
                }
            });
        } catch (err) {
            logger.warn(`Error updating document with id ${id}: ${err}`); // fixme better message
        }

        console.log(`@@@@ [PID] Target: ${Math.round(TARGET_BYTES_PER_WINDOW)} bytes, Actual: ${bytesSinceLastRead} bytes, Sample Rate: ${percent.toFixed(3)} percent`);
    }

    function logData(percentage: number, errorPct: number, bytes: number) {
        const timestamp = new Date().toISOString();
        console.log('@@@@ logData timestamp: ', timestamp);

        logStream.write(`${timestamp},${percentage.toFixed(4)},${errorPct.toFixed(4)},${bytes}\n`);
    }

    async function shutdown(): Promise<void> {
        clearInterval(updatePercentKeptInterval);
    }
}