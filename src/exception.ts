/**
 * Copyright (C) 2016-2018 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/**
 * Errors related to validation.
 */
export class ValidationError extends Error {
    // If this flag is set, then the validation error
    // will be converted to a protocol error.
    public critical: boolean;

    constructor(message: string, critical: boolean = true) {
        super(message);
        this.message = message;
        this.name = 'ValidationError';
        this.critical = critical;
    }
}
