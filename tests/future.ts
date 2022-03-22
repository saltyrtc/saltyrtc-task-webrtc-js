'use strict';

type ResolveFn<T> = (value?: T | PromiseLike<T>) => void;
type RejectFn = (reason?: any) => void;
type Executor<T> = (resolve: ResolveFn<T>, reject: RejectFn) => void;

/**
 * A future similar to Python's asyncio.Future. Allows to resolve or reject
 * outside of the executor and query the current status.
 */
export class Future<T> extends Promise<T> {
    private _done: boolean;
    private _resolve: ResolveFn<T>;
    private _reject: RejectFn;

    constructor(executor?: Executor<T>) {
        const resolve = (arg) => {
            this.resolve(arg);
        };
        const reject = (...args: any[]) => {
            this.reject(...args);
        };
        let innerResolve: ResolveFn<T>;
        let innerReject: RejectFn;

        super((resolveFunc, rejectFunc) => {
            innerResolve = resolveFunc;
            innerReject = rejectFunc;
            if (executor) {
                return executor(resolve, reject);
            }
        });

        this._done = false;
        console.assert(innerResolve !== undefined && innerReject !== undefined, 'THERE IS NO HOPE!');
        this._resolve = innerResolve;
        this._reject = innerReject;
    }

    /**
     * Wrap a promise to ensure it does not resolve before a minimum
     * duration.
     *
     * Note: The promise will still reject immediately. Furthermore, be
     *       aware that the promise does not resolve/reject inside of
     *       an AngularJS digest cycle.
     *
     * @param promise the promise or future to be wrapped
     * @param minDurationMs the minimum duration before it should be resolved
     * @returns {Future}
     */
    static withMinDuration<T>(promise: Promise<T>, minDurationMs: number): Future<T> {
        const start = new Date();
        return new Future((resolve, reject) => {
            promise
                .then((result) => {
                    const timediff = (new Date()).getTime() - start.getTime();
                    const delay = Math.max(minDurationMs - timediff, 0);
                    self.setTimeout(() => resolve(result), delay);
                })
                .catch((error) => reject(error));
        });
    }

    /**
     * Return whether the future is done (resolved or rejected).
     */
    get done() {
        return this._done;
    }

    /**
     * Resolve the future.
     */
    resolve(arg: T) {
        this._done = true;
        return this._resolve(arg);
    }

    /**
     * Reject the future.
     */
    reject(...args: any[]) {
        this._done = true;
        return this._reject(...args);
    }
}
