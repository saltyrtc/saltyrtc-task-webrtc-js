/**
 * Copyright (C) 2016-2018 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path="jasmine.d.ts" />

import "../node_modules/@babel/polyfill/dist/polyfill"; // Include ES5 polyfills

import test_nonce from "./nonce.spec";
import test_datachannel from "./datachannel.spec";
import test_integration from "./integration.spec";

let counter = 1;
beforeEach(() => console.info('------ TEST', counter++, 'BEGIN ------'));

test_nonce();
test_datachannel();
test_integration();
