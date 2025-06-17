import { isNumber } from '@terascope/job-components';
import { Config } from '../interfaces.js';

/**
 * This schema object is for the TerasliceJobSettingsController configuration settings coming from
 * its configuration file.
 */
export const schema = {
    target_rate: {
        doc: 'The target rate of index growth in MB/sec',
        default: null,
        format: (val: any) => {
            if (!isNumber(val) || val <= 0) {
                throw new Error('target_rate must be a positive number.');
            }
        }
    },
    window_ms: {
        doc: 'The time in milliseconds between recalculating the percent of records to keep',
        default: 300_000,
        format: (val: any) => {
            if (!isNumber(val) || val <= 0) {
                throw new Error('window_ms must be a positive number.');
            }
        }
    },
    minimum_percent: {
        doc: 'Minimum value the percent field can be set to',
        default: null,
        format: (val: any) => {
            if (!isNumber(val) || val < 0 || val > 100) {
                throw new Error('minimum_percent must be a number between 0 and 100 (inclusive).');
            }
        }
    },
    initial_percent_kept: {
        doc: 'Value of the percent field at controller creation.',
        default: null,
        format: (val: any) => {
            if (!isNumber(val) || val < 1 || val > 100) {
                throw new Error('initial_percent_kept must be a number between 1 and 100 (inclusive).');
            }
        }
    },
    pid_constants: {
        proportional: {
            doc: 'Proportional gain - determines the reaction to the current error.',
            default: 0.1,
            format: Number
        },
        integral: {
            doc: 'Integral gain - corrects accumulated past errors to remove steady-state error - the persistent difference between the desired and actual value.',
            default: 0.01,
            format: Number
        },
        derivative: {
            doc: 'Derivative gain - reduces oscillations by predicting future error.',
            default: 0.1,
            format: Number
        }
    },
    cluster: {
        doc: '',
        default: null,
        format: String
    },
    connections: {
        store: {
            connector: {
                doc: 'name of the terafoundation connector where the percent will be stored',
                default: null,
                format: 'required_String'
            },
            index: {
                doc: 'name of the index where the percent will be stored',
                default: null,
                format: 'required_String'
            },
            document_id: {
                doc: 'name of the document ID where the percent will be stored',
                default: null,
                format: 'required_String'
            }
        },
        sample: {
            connector: {
                doc: 'name of the terafoundation connector where index to sample is located',
                default: null,
                format: 'required_String'
            },
            daily_index_prefix: {
                doc: 'prefix of the daily index to sample. This will match the index field of the elasticsearch_sender_api config in the teraslice job writing to the index.',
                default: null,
                format: 'required_String'
            },
            date_delimiter: {
                doc: 'delimiter between date fields for the daily index. This will match the date_delimiter field of the date_router config in the teraslice job writing to the index.',
                default: '.',
                format: String
            }
        }
    }
};

export function configSchema() {
    return {
        schema: { terasliceJobSettingsController: schema },
        validatorFn: (
            config: Config
        ) => {
            const { initial_percent_kept, minimum_percent } = config;
            if (initial_percent_kept < minimum_percent) {
                throw new Error('initial_percent_kept must be greater than or equal to minimum_percent.');
            }
        }
    }
}