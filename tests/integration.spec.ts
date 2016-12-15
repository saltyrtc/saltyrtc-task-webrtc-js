/**
 * Copyright (C) 2016 Threema GmbH / SaltyRTC Contributors
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference types="webrtc" />
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
            this.lastCandidate = null;
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
                    task.once('answer', (e: saltyrtc.tasks.webrtc.AnswerEvent) => {
                        resolve(e.data);
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
                    task.once('offer', (offer: saltyrtc.tasks.webrtc.OfferEvent) => {
                        resolve(offer.data);
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
        function setupIceCandidateHandling(pc: RTCPeerConnection, task: WebRTCTask, _this: any) {
            let role = task.getSignaling().role;
            let logTag = role.charAt(0).toUpperCase() + role.slice(1) + ':';
            console.debug(logTag, 'Setting up ICE candidate handling');
            pc.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
                if (e.candidate) {
                    _this.lastCandidate = e.candidate;
                    task.sendCandidate({
                        candidate: e.candidate.candidate,
                        sdpMid: e.candidate.sdpMid,
                        sdpMLineIndex: e.candidate.sdpMLineIndex,
                    });
                }
            };
            pc.onicecandidateerror = (e: RTCPeerConnectionIceErrorEvent) => {
                console.error(logTag, 'ICE candidate error:', e);
            };
            task.on('candidates', (e: saltyrtc.tasks.webrtc.CandidatesEvent) => {
                for (let candidateInit of e.data) {
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
        async function setupPeerConnection(doHandover=true): Promise<{initiator: RTCPeerConnection, responder: RTCPeerConnection}> {
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
            setupIceCandidateHandling(initiatorConn, this.initiatorTask, this);
            setupIceCandidateHandling(responderConn, this.responderTask, this);

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
                    this.initiator.once('handover', handoverHandler);
                    this.responder.once('handover', handoverHandler);
                });
            };

            if (doHandover) {
                await handover();
                console.info('Handover done.');
            }

            return {
                'initiator': initiatorConn,
                'responder': responderConn,
            }
        }

        it('can send offers', async (done) => {
            await this.connectBoth(this.initiator, this.responder, 'task');
            this.responderTask.on('offer', (e: saltyrtc.tasks.webrtc.OfferEvent) => {
                expect(e.type).toEqual('offer');
                expect(e.data.type).toEqual('offer');
                expect(e.data.sdp).toEqual('YOLO');
                done();
            });
            this.initiatorTask.sendOffer({'type': 'offer', 'sdp': 'YOLO'});
        });

        it('can send answers', async (done) => {
            await this.connectBoth(this.initiator, this.responder, 'task');
            this.initiatorTask.on('answer', (e: saltyrtc.tasks.webrtc.AnswerEvent) => {
                expect(e.type).toEqual('answer');
                expect(e.data.type).toEqual('answer');
                expect(e.data.sdp).toEqual('YOLO');
                done();
            });
            this.responderTask.sendAnswer({'type': 'answer', 'sdp': 'YOLO'});
        });

        it('can send candidates', async (done) => {
            await this.connectBoth(this.initiator, this.responder, 'task');

            const candidates: saltyrtc.tasks.webrtc.Candidates = [
                {'candidate': 'FOO', 'sdpMid': 'data', 'sdpMLineIndex': 0},
                {'candidate': 'BAR', 'sdpMid': 'data', 'sdpMLineIndex': 1},
            ];

            this.responderTask.on('candidates', (e: saltyrtc.tasks.webrtc.CandidatesEvent) => {
                expect(e.type).toEqual('candidates');
                expect(Array.isArray(e.data)).toEqual(true);
                expect(e.data.length).toEqual(candidates.length);
                expect(e.data).toEqual(candidates);
                done();
            });
            this.initiatorTask.sendCandidates(candidates);
        });

        it('can send buffered candidates', async (done) => {
            await this.connectBoth(this.initiator, this.responder, 'task');

            const candidates: saltyrtc.tasks.webrtc.Candidates = [
                {'candidate': 'FOO', 'sdpMid': 'data', 'sdpMLineIndex': 0},
                {'candidate': 'BAR', 'sdpMid': 'data', 'sdpMLineIndex': 1},
            ];

            this.responderTask.on('candidates', (e: saltyrtc.tasks.webrtc.CandidatesEvent) => {
                expect(e.type).toEqual('candidates');
                expect(Array.isArray(e.data)).toEqual(true);
                expect(e.data.length).toEqual(candidates.length);
                expect(e.data).toEqual(candidates);
                done();
            });
            this.initiatorTask.sendCandidate(candidates[0]);
            this.initiatorTask.sendCandidate(candidates[1]);
        });

        it('can set up an encryted signaling channel', async (done) => {
            await setupPeerConnection.bind(this)();
            const initiatorSdc = ((this.initiatorTask as any).sdc as saltyrtc.tasks.webrtc.SecureDataChannel);
            const responderSdc = ((this.responderTask as any).sdc as saltyrtc.tasks.webrtc.SecureDataChannel);
            expect(initiatorSdc.readyState).toEqual('open');
            expect(responderSdc.readyState).toEqual('open');

            // Send a message back and forth
            const pingPoingTest = () => {
                return new Promise((resolve, reject) => {
                    responderSdc.onmessage = (e: MessageEvent) => {
                        expect(new Uint8Array(e.data)).toEqual(Uint8Array.of(1, 2, 3));
                        responderSdc.send(Uint8Array.of(4, 5, 6));
                    };
                    initiatorSdc.onmessage = (e: MessageEvent) => {
                        expect(new Uint8Array(e.data)).toEqual(Uint8Array.of(4, 5, 6));
                        resolve();
                    };
                    initiatorSdc.send(Uint8Array.of(1, 2, 3));
                });
            };
            await pingPoingTest();

            // Make sure it's encrypted
            const encryptionTest = () => {
                return new Promise((resolve, reject) => {
                    ((responderSdc as any).dc as RTCDataChannel).onmessage = (e: MessageEvent) => {
                        const bytes = new Uint8Array(e.data);
                        expect(bytes).not.toEqual(Uint8Array.of(7, 6, 7));
                        const expectedLength = 24 /* nonce */ + 9 /* chunking */ +
                                               16 /* authenticator */ + 3 /* data */;
                        expect(bytes.byteLength).toEqual(expectedLength);
                        resolve();
                    };
                    initiatorSdc.send(Uint8Array.of(7, 6, 7));
                });
            };
            await encryptionTest();

            done();
        });

        it('can wrap a data channel', async (done) => {
            let connections: {
                initiator: RTCPeerConnection,
                responder: RTCPeerConnection,
            } = await setupPeerConnection.bind(this)();

            // Create a new unencrypted datachannel
            let testUnencrypted = () => {
                return new Promise((resolve) => {
                    connections.responder.ondatachannel = (e: RTCDataChannelEvent) => {
                        e.channel.onmessage = (e: MessageEvent) => {
                            expect(e.data).toEqual('bonjour');
                            resolve();
                        };
                    };
                    let dc = connections.initiator.createDataChannel('dc1');
                    dc.binaryType = 'arraybuffer';
                    dc.send('bonjour');
                });
            };
            await testUnencrypted();
            console.info('Unencrypted test done');

            // Wrap data channel
            let testEncrypted = () => {
                return new Promise((resolve) => {
                    connections.responder.ondatachannel = (e: RTCDataChannelEvent) => {
                        // The receiver should get encrypted data.
                        e.channel.binaryType = 'arraybuffer';
                        e.channel.onmessage = (e: MessageEvent) => {
                            expect(new Uint8Array(e.data)).not.toEqual(new Uint16Array([1, 1337, 9]));
                            expect(e.data.byteLength).toEqual(9 + 24 + 16 + 3);
                            resolve();
                        };
                    };
                    let dc = connections.initiator.createDataChannel('dc2');
                    dc.binaryType = 'arraybuffer';
                    let safedc = this.initiatorTask.wrapDataChannel(dc);
                    safedc.send(new Uint8Array([1, 1337, 9]));
                });
            };
            await testEncrypted();
            console.info('Encrypted test done');

            done();
        });

        it('can send signaling messages after handover', async (done) => {
            await setupPeerConnection.bind(this)();
            const initiatorSdc = ((this.initiatorTask as any).sdc as saltyrtc.tasks.webrtc.SecureDataChannel);
            const responderSdc = ((this.responderTask as any).sdc as saltyrtc.tasks.webrtc.SecureDataChannel);
            expect(initiatorSdc.readyState).toEqual('open');
            expect(responderSdc.readyState).toEqual('open');

            const candidateTest = () => {
                return new Promise((resolve) => {
                    this.responderTask.once('candidates', (e: saltyrtc.tasks.webrtc.CandidatesEvent) => {
                        resolve();
                    });
                    this.initiatorTask.sendCandidate({
                        candidate: this.lastCandidate.candidate,
                        sdpMid: this.lastCandidate.sdpMid,
                        sdpMLineIndex: this.lastCandidate.sdpMLineIndex,
                    });
                });
            };
            await candidateTest();

            done();
        });

        it('cannot do handover if disabled via constructor', async (done) => {
            this.responderTask = new WebRTCTask(false);
            this.responder = new SaltyRTCBuilder()
                .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                .withKeyStore(new KeyStore())
                .initiatorInfo(this.initiator.permanentKeyBytes, this.initiator.authTokenBytes)
                .usingTasks([this.responderTask])
                .asResponder() as saltyrtc.SaltyRTC;
            await setupPeerConnection.bind(this)(false);
            expect(this.responderTask.handover()).toEqual(false);
            done();
        });

        it('can safely increase the chunk size', async (done) => {
            this.initiatorTask = new WebRTCTask(true, 65536);
            this.initiator = new SaltyRTCBuilder()
                .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                .withKeyStore(new KeyStore())
                .usingTasks([this.initiatorTask])
                .asInitiator() as saltyrtc.SaltyRTC;
            this.responderTask = new WebRTCTask(true, 65536);
            this.responder = new SaltyRTCBuilder()
                .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                .withKeyStore(new KeyStore())
                .initiatorInfo(this.initiator.permanentKeyBytes, this.initiator.authTokenBytes)
                .usingTasks([this.responderTask])
                .asResponder() as saltyrtc.SaltyRTC;

            let connections: {
                initiator: RTCPeerConnection,
                responder: RTCPeerConnection,
            } = await setupPeerConnection.bind(this)();

            // Wrap data channel
            const data = nacl.randomBytes(60000); // 60'000 bytes of random data
            let testEncrypted = () => {
                return new Promise((resolve) => {
                    connections.responder.ondatachannel = (e: RTCDataChannelEvent) => {
                        // The receiver should get encrypted data.
                        e.channel.binaryType = 'arraybuffer';
                        e.channel.onmessage = (e: MessageEvent) => {
                            const expectedLength = 24 /* nonce */ + 9 /* chunking */ +
                                                   16 /* authenticator */ + 60000 /* data */;
                            expect(e.data.byteLength).toEqual(expectedLength);
                            //expect(e.data.byteLength).toEqual(9 + 24 + 16 + 3);
                            resolve();
                        };
                    };
                    let dc = connections.initiator.createDataChannel('dc');
                    dc.binaryType = 'arraybuffer';
                    let safedc = this.initiatorTask.wrapDataChannel(dc);
                    safedc.send(data);
                });
            };
            await testEncrypted();
            console.info('Data channel test with chunk size 65536 done');

            done();
        });
    });

}); }
