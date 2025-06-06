import { Context } from './interfaces';

export function isPromAvailable(context: Context) {
    return context.apis.foundation.promMetrics !== undefined
        && context.apis.foundation.promMetrics.verifyAPI();
}