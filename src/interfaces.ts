import { ESLikeClient as ES } from '@terascope/types';
export interface Config {
    terasliceJobSettingsController: {
        connections: {
            store: {
                connector: string;
                index: string;
                document_id: string;
            };
            sample: {
                connector: string;
                index: string;
            };
        }
        window_ms: number;
        target_rate: number;
        initial_percent_kept: number;
        pid_constants: [number, number, number];
    }
}

export interface Client {
    get: (query: ES.GetParams, fullResponse?: boolean) => Promise<any>;
    cat: {
        indices: (params: ES.CatIndicesParams) => Promise<ES.CatIndicesResponse>;
    }
    update: (params: ES.UpdateParams) => Promise<ES.UpdateResponse>; 
}