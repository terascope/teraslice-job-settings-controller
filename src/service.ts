import { fileURLToPath } from 'node:url';
import { ClusterContext } from 'terafoundation';
import { formats } from '@terascope/job-components';
import { worker } from './worker.js'
import { Config } from './interfaces.js';

const filePath = fileURLToPath(new URL('.', import.meta.url));

function configSchema() {
    return {};
}


await ClusterContext.createContext<Config>({
    name: 'terasliceJobSettingsController',
    worker,
    schema_formats: formats,
    config_schema: configSchema
});
