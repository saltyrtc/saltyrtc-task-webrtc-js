/**
 * Copyright (C) 2016 Threema GmbH / SaltyRTC Contributors
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path="jasmine.d.ts" />

import "../node_modules/babel-es6-polyfill/browser-polyfill";

import test_datachannel from "./test_datachannel.spec";

let counter = 1;
beforeEach(() => console.info('------ TEST', counter++, 'BEGIN ------'));

test_datachannel();
