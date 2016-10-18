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

        /**
         * Do the initiator flow.
         */
        async function initiatorFlow(pc: RTCPeerConnection, task: WebRTCTask): Promise<void> {
            // Send offer
            let offer: RTCSessionDescriptionInit = await pc.createOffer();
            await pc.setLocalDescription(offer);
            console.debug('Initiator: Created offer, set local description');
            task.sendOffer(offer);

            // Receive answer
            function receiveAnswer(): Promise<RTCSessionDescriptionInit> {
                return new Promise((resolve) => {
                    task.once('answer', (message: saltyrtc.messages.TaskMessage) => {
                        resolve(message.data.answer);
                    });
                });
            }
            let answer: RTCSessionDescriptionInit = await receiveAnswer();
            await pc.setRemoteDescription(answer)
              .catch(error => console.error('Could not set remote description', error));
            console.debug('Initiator: Received answer, set remote description');
        }

        /**
         * Do the responder flow.
         */
        async function responderFlow(pc: RTCPeerConnection, task: WebRTCTask): Promise<void> {
            // Receive offer
            function receiveOffer(): Promise<RTCSessionDescriptionInit> {
                return new Promise((resolve) => {
                    task.once('offer', (message: saltyrtc.messages.TaskMessage) => {
                        resolve(message.data.offer);
                    });
                });
            }
            let offer: RTCSessionDescriptionInit = await receiveOffer();
            await pc.setRemoteDescription(offer)
              .catch(error => console.error('Could not set remote description', error));
            console.debug('Initiator: Received offer, set remote description');

            // Send answer
            let answer: RTCSessionDescriptionInit = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.debug('Initiator: Created answer, set local description');
            task.sendAnswer(answer);
        }

        /**
         * Set up transmission and processing of ICE candidates.
         */
        function setupIceCandidateHandling(pc: RTCPeerConnection, task: WebRTCTask) {
            let role = task.getSignaling().role;
            let logTag = role.charAt(0).toUpperCase() + role.slice(1) + ':';
            console.debug(logTag, 'Setting up ICE candidate handling');
            pc.onicecandidate = (e: RTCIceCandidateEvent) => {
                if (e.candidate) {
                    task.sendCandidates([{
                        candidate: e.candidate.candidate,
                        sdpMid: e.candidate.sdpMid,
                        sdpMLineIndex: e.candidate.sdpMLineIndex,
                    }]);
                }
            };
            pc.onicecandidateerror = (e: RTCPeerConnectionIceErrorEvent) => {
                console.error(logTag, 'ICE candidate error:', e);
            };
            task.on('candidates', (message: saltyrtc.messages.TaskMessage) => {
                for (let candidateInit of message.data.candidates) {
                    pc.addIceCandidate(candidateInit);
                }
            });
            pc.oniceconnectionstatechange = (e: Event) => {
                console.debug(logTag, 'ICE connection state changed to', pc.iceConnectionState);
                console.debug(logTag, 'ICE gathering state changed to', pc.iceGatheringState);
            }
        }

        /**
         * Connect a peer.
         */
        function connect(salty: saltyrtc.SaltyRTC): Promise<{}> {
            return new Promise((resolve) => {
                salty.once('state-change:task', () => {
                    resolve();
                });
                salty.connect();
            });
        }

        /**
         * Create two peer connections and do the handshake.
         */
        async function setupPeerConnection(): Promise<{initiator: RTCPeerConnection, responder: RTCPeerConnection}> {
            // Create peer connections
            const initiatorConn = new RTCPeerConnection();
            const responderConn = new RTCPeerConnection();

            // Connect both peers
            const connectInitiator = connect(this.initiator);
            const connectResponder = connect(this.responder);
            await connectInitiator;
            await connectResponder;

            // Do initiator flow
            initiatorConn.onnegotiationneeded = (e: Event) => {
                initiatorFlow(initiatorConn, this.initiatorTask).then(
                    (value) => console.debug('Initiator flow successful'),
                    (error) => console.error('Initiator flow failed', error)
                );
            };

            // Do responder flow
            responderConn.onnegotiationneeded = (e: Event) => {
                responderFlow(responderConn, this.responderTask).then(
                    (value) => console.debug('Responder flow successful'),
                    (error) => console.error('Responder flow failed', error)
                );
            };

            // Set up ICE candidate handling
            setupIceCandidateHandling(initiatorConn, this.initiatorTask);
            setupIceCandidateHandling(responderConn, this.responderTask);

            // Do handover
            let handover = () => {
                return new Promise((resolve) => {
                    this.initiatorTask.handover(initiatorConn);
                    this.responderTask.handover(responderConn);

                    let handoverCount = 0;
                    let handoverHandler = () => {
                        handoverCount += 1;
                        if (handoverCount == 2) {
                            resolve();
                        }
                    };
                    this.initiatorTask.once('handover', handoverHandler);
                    this.responderTask.once('handover', handoverHandler);
                });
            };
            await handover();
            console.info('Handover done.');

            return {
                'initiator': initiatorConn,
                'responder': responderConn,
            }
        }

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

        it('can set up an encryted signaling channel', async (done) => {
            await setupPeerConnection.bind(this)();
            const initiatorSdc = ((this.initiatorTask as any).sdc as saltyrtc.tasks.webrtc.SecureDataChannel);
            const responderSdc = ((this.responderTask as any).sdc as saltyrtc.tasks.webrtc.SecureDataChannel);
            expect(initiatorSdc.readyState).toEqual('open');
            expect(responderSdc.readyState).toEqual('open');
            done();
        });
    });

}); }
