import { ClusterContext } from 'terafoundation';
import { worker } from './worker.js'
import { ControllerConfig } from './interfaces.js';
import { configSchema } from './schemas/system.js';

await ClusterContext.createContext<ControllerConfig>({
    name: 'terasliceJobSettingsController',
    worker,
    config_schema: configSchema
});
