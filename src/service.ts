import { ClusterContext } from 'terafoundation';
import { formats } from '@terascope/job-components';
import { worker } from './worker.js'
import { Config } from './interfaces.js';
import { configSchema } from './schemas/system.js';

await ClusterContext.createContext<Config>({
    name: 'terasliceJobSettingsController',
    worker,
    schema_formats: formats,
    config_schema: configSchema
});
