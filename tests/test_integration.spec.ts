/**
 * Copyright (C) 2016 Threema GmbH / SaltyRTC Contributors
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path="jasmine.d.ts" />

import {SaltyRTCBuilder, KeyStore} from "saltyrtc-client";
import {Config} from "./config";
import {DummyTask} from "./testtasks";

export default () => { describe('Integration Tests', function() {

    beforeEach(() => {
        // Connect and await a certain state for two peers
        this.connectBoth = (a, b, state) => {
            let ready = 0;
            return new Promise((resolve) => {
                a.once('state-change:' + state, () => { ready += 1; if (ready == 2) resolve(); });
                b.once('state-change:' + state, () => { ready += 1; if (ready == 2) resolve(); });
                a.connect();
                b.connect();
            });
        }
    });

    describe('SaltyRTC', () => {
        it('connects', async (done) => {
            const initiator = new SaltyRTCBuilder()
                .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                .withKeyStore(new KeyStore())
                .usingTasks([new DummyTask()])
                .asInitiator() as saltyrtc.SaltyRTC;
            const responder = new SaltyRTCBuilder()
                .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                .withKeyStore(new KeyStore())
                .initiatorInfo(initiator.permanentKeyBytes, initiator.authTokenBytes)
                .usingTasks([new DummyTask()])
                .asResponder() as saltyrtc.SaltyRTC;
            expect(initiator.state).toEqual('new');
            expect(responder.state).toEqual('new');
            await this.connectBoth(initiator, responder, 'task');
            expect(initiator.state).toBe('task');
            expect(responder.state).toBe('task');
            done();
        });

    });

}); }
