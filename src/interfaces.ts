import { ESLikeClient as ES, Terafoundation } from '@terascope/types';

export interface Config {
    cluster: string;
    connections: {
        store: {
            connector: string;
            index: string;
            document_id: string;
        };
        sample: {
            connector: string;
            daily_index_prefix: string;
            date_delimiter: string;
        };
    }
    window_ms: number;
    target_rate: number;
    initial_percent_kept: number;
    minimum_percent: number;
    pid_constants: PIDConstants;
}

export interface ControllerConfig {
    terasliceJobSettingsController: Config;
}

export interface Client {
    get: (query: ES.GetParams, fullResponse?: boolean) => Promise<any>;
    cat: {
        indices: (params: ES.CatIndicesParams) => Promise<ES.CatIndicesResponse>;
    }
    update: (params: ES.UpdateParams) => Promise<ES.UpdateResponse>; 
}

export type Context = Terafoundation.Context<ControllerConfig>;

export interface PIDConstants {
    proportional: number;
    integral: number;
    derivative: number;
}
