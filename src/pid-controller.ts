import { Logger } from "@terascope/types";
import { isPromAvailable } from "./helpers.js";
import { Context, PIDConstants } from "./interfaces.js";

export default class PIDController {
    context: Context;
    logger: Logger;
    private outputMin: number;
    private outputMax: number;
    private kp: number;
    private ki: number;
    private kd: number;

    private integral = 0;
    private lastError = 0;

    /**
     * A simple Proportional–integral–derivative controller implementation
     * https://en.wikipedia.org/wiki/Proportional%E2%80%93integral%E2%80%93derivative_controller
     *
     * @param {Context} context 
     * @param {number} min Minimum allowable output
     * @param {number} max Maximum allowable output
     * @param {object} pidConstants object containing proportional, integral and derivative constants
    */
    constructor(context: Context, min: number, max: number, pidConstants: PIDConstants) {
        this.context = context;
        this.logger = context.logger;
        this.kp = pidConstants.proportional;
        this.ki = pidConstants.integral;
        this.kd = pidConstants.derivative;
        this.outputMin = min;
        this.outputMax = max;
    }

    async initialize() {
        if (isPromAvailable(this.context)) {
            await this.context.apis.foundation.promMetrics.addGauge(
                'proportional',
                'Proportional error calculation',
                ['class']
            );

            await this.context.apis.foundation.promMetrics.addGauge(
                'integral',
                'Integral error calculation',
                ['class']
            );

            await this.context.apis.foundation.promMetrics.addGauge(
                'derivative',
                'Derivative error calculation',
                ['class']
            );

            await this.context.apis.foundation.promMetrics.addGauge(
                'unclamped_output',
                'Output of the PID control function prior to clamping',
                ['class']
            );
        }
    }

    /**
     * 
     * @param error percentage difference between the desired setpoint and the measured process variable.
     * In this case the setpoint is the desired number of bytes for a window of time (TARGET_BYTES_PER_WINDOW).
     * The process variable is the increase in the size of an elasticsearch index since the last check (bytesSinceLastRead)
     * The error percentage is then calculated as (process variable - setpoint) / process variable.
     * @returns 
     */
    update(error: number): number {
        const derivative = error - this.lastError;
        const tempIntegral = this.integral + error;

        const unclampedOutput = this.kp * error + this.ki * tempIntegral + this.kd * derivative;

        // clamp the output
        const output = Math.max(this.outputMin, Math.min(this.outputMax, unclampedOutput));

        // check if output is saturated and error is not improving
        const outputSaturatedHigh = output === this.outputMax && error > 0;
        const outputSaturatedLow = output === this.outputMin && error < 0;

        // only update integral if output is not saturated
        if (!outputSaturatedHigh && !outputSaturatedLow) {
            this.integral = tempIntegral;
        }
        
        this.logger.debug({
            previousError: this.lastError,
            derivative,
            tempIntegral,
            unclampedOutput,
            output,
            outputSaturatedHigh,
            outputSaturatedLow,
            integral: this.integral
        })

        this.setMetrics(error, this.integral, derivative, unclampedOutput);

        this.lastError = error;

        return output;
    }

    setMetrics(proportional: number, integral: number, derivative: number, unclampedOutput: number) {
        if (isPromAvailable(this.context)) {
            this.context.apis.foundation.promMetrics.set(
                'proportional',
                { class: 'PIDController'},
                proportional
            );

            this.context.apis.foundation.promMetrics.set(
                'integral',
                { class: 'PIDController'},
                integral
            );

            this.context.apis.foundation.promMetrics.set(
                'derivative',
                { class: 'PIDController'},
                derivative
            );

            this.context.apis.foundation.promMetrics.set(
                'unclamped_output',
                { class: 'PIDController'},
                unclampedOutput
            );
        }
    }
}
