/**
 * Copyright (C) 2016-2017 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path="jasmine.d.ts" />

import "../node_modules/babel-es6-polyfill/browser-polyfill";

import test_nonce from "./nonce.spec";
import test_datachannel from "./datachannel.spec";
import test_integration from "./integration.spec";

let counter = 1;
beforeEach(() => console.info('------ TEST', counter++, 'BEGIN ------'));

test_nonce();
test_datachannel();
test_integration();
