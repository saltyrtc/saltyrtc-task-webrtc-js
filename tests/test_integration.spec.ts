/**
 * Copyright (C) 2016 Threema GmbH / SaltyRTC Contributors
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path="jasmine.d.ts" />

import {SaltyRTCBuilder, KeyStore} from "saltyrtc-client";
import {WebRTCTask} from "../src/main";
import {Config} from "./config";
import {DummyTask} from "./testtasks";

export default () => { describe('Integration Tests', function() {

    beforeEach(() => {
        // Set default timeout
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 3000;

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

    describe('WebRTCTask', () => {

        beforeEach(() => {
            this.initiatorTask = new WebRTCTask();
            this.initiator = new SaltyRTCBuilder()
                .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                .withKeyStore(new KeyStore())
                .usingTasks([this.initiatorTask])
                .asInitiator() as saltyrtc.SaltyRTC;
            this.responderTask = new WebRTCTask();
            this.responder = new SaltyRTCBuilder()
                .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                .withKeyStore(new KeyStore())
                .initiatorInfo(this.initiator.permanentKeyBytes, this.initiator.authTokenBytes)
                .usingTasks([this.responderTask])
                .asResponder() as saltyrtc.SaltyRTC;
        });

        it('can send offers', async (done) => {
            await this.connectBoth(this.initiator, this.responder, 'task');
            this.responderTask.on('offer', (e: saltyrtc.SaltyRTCEvent) => {
                expect(e.type).toEqual('offer');
                expect(e.data.offer.type).toEqual('offer');
                expect(e.data.offer.sdp).toEqual('YOLO');
                done();
            });
            this.initiatorTask.sendOffer({'type': 'offer', 'sdp': 'YOLO'});
        });

        it('can send answers', async (done) => {
            await this.connectBoth(this.initiator, this.responder, 'task');
            this.initiatorTask.on('answer', (e: saltyrtc.SaltyRTCEvent) => {
                expect(e.type).toEqual('answer');
                expect(e.data.answer.type).toEqual('answer');
                expect(e.data.answer.sdp).toEqual('YOLO');
                done();
            });
            this.responderTask.sendAnswer({'type': 'answer', 'sdp': 'YOLO'});
        });

        it('can send candidates', async (done) => {
            await this.connectBoth(this.initiator, this.responder, 'task');

            const candidates = [
                {'candidate': 'FOO', 'sdpMid': 'data', 'sdpMLineIndex': 0},
                {'candidate': 'BAR', 'sdpMid': 'data', 'sdpMLineIndex': 1},
            ];

            this.responderTask.on('candidates', (e: saltyrtc.SaltyRTCEvent) => {
                expect(e.type).toEqual('candidates');
                expect(Array.isArray(e.data.candidates)).toEqual(true);
                expect(e.data.candidates.length).toEqual(candidates.length);
                expect(e.data.candidates).toEqual(candidates);
                done();
            });
            this.initiatorTask.sendCandidates(candidates);
        });
    });

}); }
