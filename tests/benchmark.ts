/**
 * Copyright (C) 2017 Lennart Grahl
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path="jasmine.d.ts" />

import "../node_modules/babel-es6-polyfill/browser-polyfill";

import benchmark_datachannel from "./datachannel.perf";

let counter = 1;
beforeEach(() => console.info('------ TEST', counter++, 'BEGIN ------'));

benchmark_datachannel();
