/**
 * Copyright (C) 2016-2022 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path="jasmine.d.ts" />

import {WebRTCTaskBuilder} from "../src/main";
import {Config} from "./config";
import {DummyTask} from "./testtasks";
import {DataChannelCryptoContext} from "../src/crypto";

type PeerContext = {
    signaling: saltyrtc.SaltyRTC,
    task?: saltyrtc.tasks.webrtc.WebRTCTask,
    pc?: RTCPeerConnection,
    dc?: RTCDataChannel,
    link?: saltyrtc.tasks.webrtc.SignalingTransportLink,
    handler?: saltyrtc.tasks.webrtc.SignalingTransportHandler,
    lastCandidate?: RTCIceCandidate,
}

type PeerContextPair = {
    initiator: PeerContext,
    responder: PeerContext,
}

export default () => {
    describe('Integration Tests', function() {
        const LOG_LEVEL = 'info';

        // Connect and await a certain state for two peers
        function connectBoth(pair: PeerContextPair, state): Promise<any> {
            pair.initiator.signaling.connect();
            pair.responder.signaling.connect();
            return Promise.all([
                new Promise((resolve) => {
                    pair.initiator.signaling.once('state-change:' + state, () => resolve());
                }),
                new Promise((resolve) => {
                    pair.responder.signaling.once('state-change:' + state, () => resolve());
                }),
            ]);
        }

        beforeEach(() => {
            // Set default timeout
            jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
        });

        describe('SaltyRTC', () => {
            it('connects', async () => {
                const initiator = new saltyrtcClient.SaltyRTCBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                    .withKeyStore(new saltyrtcClient.KeyStore())
                    .usingTasks([new DummyTask()])
                    .asInitiator() as saltyrtc.SaltyRTC;
                const responder = new saltyrtcClient.SaltyRTCBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                    .withKeyStore(new saltyrtcClient.KeyStore())
                    .initiatorInfo(initiator.permanentKeyBytes, initiator.authTokenBytes)
                    .usingTasks([new DummyTask()])
                    .asResponder() as saltyrtc.SaltyRTC;
                expect(initiator.state).toEqual('new');
                expect(responder.state).toEqual('new');
                await connectBoth({
                    initiator: { signaling: initiator },
                    responder: { signaling: responder },
                }, 'task');
                expect(initiator.state).toBe('task');
                expect(responder.state).toBe('task');
            });
        });

        describe('WebRTCTask', () => {
            let pair: PeerContextPair;

            beforeEach(() => {
                const initiatorTask = new WebRTCTaskBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .build();
                const initiator = new saltyrtcClient.SaltyRTCBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                    .withKeyStore(new saltyrtcClient.KeyStore())
                    .usingTasks([initiatorTask])
                    .asInitiator() as saltyrtc.SaltyRTC;
                const responderTask = new WebRTCTaskBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .build();
                const responder = new saltyrtcClient.SaltyRTCBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                    .withKeyStore(new saltyrtcClient.KeyStore())
                    .initiatorInfo(initiator.permanentKeyBytes, initiator.authTokenBytes)
                    .usingTasks([responderTask])
                    .asResponder() as saltyrtc.SaltyRTC;
                pair = {
                    initiator: {
                        signaling: initiator,
                        task: initiatorTask,
                    },
                    responder: {
                        signaling: responder,
                        task: responderTask,
                    },
                } as PeerContextPair;
            });

            /**
             * Do the initiator flow.
             */
            async function initiatorFlow(context: PeerContext): Promise<void> {
                // Send offer
                let offer: RTCSessionDescriptionInit = await context.pc.createOffer();
                await context.pc.setLocalDescription(offer);
                console.debug('Initiator: Created offer, set local description');
                context.task.sendOffer(offer);

                // Receive answer
                function receiveAnswer(): Promise<RTCSessionDescriptionInit> {
                    return new Promise((resolve) => {
                        context.task.once('answer', (e: saltyrtc.tasks.webrtc.AnswerEvent) => {
                            resolve(e.data);
                        });
                    });
                }
                let answer: RTCSessionDescriptionInit = await receiveAnswer();
                await context.pc.setRemoteDescription(answer)
                    .catch(error => console.error('Could not set remote description', error));
                console.debug('Initiator: Received answer, set remote description');
            }

            /**
             * Do the responder flow.
             */
            async function responderFlow(context: PeerContext): Promise<void> {
                // Receive offer
                function receiveOffer(): Promise<RTCSessionDescriptionInit> {
                    return new Promise((resolve) => {
                        context.task.once('offer', (offer: saltyrtc.tasks.webrtc.OfferEvent) => {
                            resolve(offer.data);
                        });
                    });
                }
                let offer: RTCSessionDescriptionInit = await receiveOffer();
                await context.pc.setRemoteDescription(offer)
                    .catch(error => console.error('Could not set remote description', error));
                console.debug('Initiator: Received offer, set remote description');

                // Send answer
                let answer: RTCSessionDescriptionInit = await context.pc.createAnswer();
                await context.pc.setLocalDescription(answer);
                console.debug('Initiator: Created answer, set local description');
                context.task.sendAnswer(answer);
            }

            /**
             * Set up transmission and processing of ICE candidates.
             */
            function setupIceCandidateHandling(context: PeerContext): void {
                let role = (context.task as any).signaling.role;
                let logTag = role.charAt(0).toUpperCase() + role.slice(1) + ':';
                console.debug(logTag, 'Setting up ICE candidate handling');
                context.pc.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
                    if (e.candidate !== null) {
                        context.lastCandidate = e.candidate;
                        context.task.sendCandidate({
                            candidate: e.candidate.candidate,
                            sdpMid: e.candidate.sdpMid,
                            sdpMLineIndex: e.candidate.sdpMLineIndex,
                        });
                    } else {
                        context.task.sendCandidate(null);
                    }
                };
                context.pc.onicecandidateerror = (e: RTCPeerConnectionIceErrorEvent) => {
                    console.error(logTag, 'ICE candidate error:', e);
                };
                context.task.on('candidates', (e: saltyrtc.tasks.webrtc.CandidatesEvent) => {
                    for (let candidateInit of e.data) {
                        context.pc.addIceCandidate(candidateInit).catch((error) => {
                            console.error('Unable to add candidate:', candidateInit, error);
                        });
                    }
                });
                context.pc.oniceconnectionstatechange = () => {
                    console.debug(
                        logTag, 'ICE connection state changed to', context.pc.iceConnectionState);
                    console.debug(
                        logTag, 'ICE gathering state changed to', context.pc.iceGatheringState);
                }
            }

            /**
             * Connect a peer.
             */
            function connect(context: PeerContext): Promise<void> {
                return new Promise((resolve) => {
                    context.signaling.once('state-change:task', () => {
                        resolve();
                    });
                    context.signaling.connect();
                });
            }

            /*
             * Wait until all remote candidates have been received.
             */
            function allIceCandidatesReceived(context: PeerContext): Promise<void> {
                return new Promise((resolve) => {
                    context.task.on('candidates', (event: saltyrtc.tasks.webrtc.CandidatesEvent) => {
                        if ((event.data as Array<RTCIceCandidateInit>).includes(null)) {
                            resolve();
                        }
                    })
                });
            }

            class SignalingTransportHandler implements saltyrtc.tasks.webrtc.SignalingTransportHandler {
                private readonly pc: RTCPeerConnection;
                private readonly dc: RTCDataChannel;

                public constructor(pc: RTCPeerConnection, dc: RTCDataChannel,) {
                    this.pc = pc;
                    this.dc = dc;
                }

                // noinspection JSUnusedGlobalSymbols
                public get maxMessageSize(): number {
                    return this.pc.sctp.maxMessageSize;
                }

                public close(): void {
                    this.dc.close();
                }

                public send(message: Uint8Array): void {
                    this.dc.send(message);
                }
            }

            /**
             * Nudge the peer connection to do something.
             */
            function jeezJustStart(context: PeerContext): void {
                context.pc.createDataChannel('jeez-just-start-already...', {
                    negotiated: true,
                    id: 42,
                });
            }

            /**
             * Create a secure data channel for handover.
             *
             * Important: The resulting data channel is not flow controlled and
             *            thus may close when buffering large amounts of data.
             */
            function handoverToDataChannel(
                context: PeerContext, messageHandler?: (event: MessageEvent) => void,
            ): Promise<void> {
                return new Promise((resolve, reject) => {
                    // Get transport link
                    const link = context.task.getTransportLink();

                    // Create dedicated data channel
                    const dc = context.pc.createDataChannel(link.label, {
                        id: link.id,
                        negotiated: true,
                        ordered: true,
                        protocol: link.protocol,
                    });
                    dc.binaryType = 'arraybuffer';

                    // Create handler
                    const handler = new SignalingTransportHandler(context.pc, dc);

                    // Bind events
                    dc.onopen = () => {
                        // Rebind close, unbind error
                        dc.onclose = () => {
                            try {
                                link.closed();
                            } catch (error) {
                                console.error('Unable to forward closed event to link:', error);
                            }
                        };
                        dc.onerror = undefined;

                        // Initiate handover
                        context.task.handover(handler);
                    };
                    dc.onclose = () => reject('closed');
                    dc.onerror = (error) => reject(error);

                    // Attach message handler(s)
                    dc.onmessage = (event: MessageEvent) => {
                        if (messageHandler) {
                            messageHandler(event);
                        }
                        if (event.data instanceof ArrayBuffer) {
                            try {
                                link.receive(new Uint8Array(event.data));
                            } catch (error) {
                                console.error('Could not forward message to link:', error);
                                dc.close();
                            }
                        } else {
                            console.error('Invalid message type');
                        }
                    };

                    // Wait for handover to be finished
                    context.signaling.once('handover', () => resolve());

                    // Store instances on context
                    context.dc = dc;
                    context.link = link;
                    context.handler = handler;
                });
            }

            /**
             * Create two peer connections and do the handshake.
             */
            async function setupPeerConnection(
                pair: PeerContextPair, doHandover: boolean = true
            ): Promise<void> {
                // Create peer connections
                pair.initiator.pc = new RTCPeerConnection();
                pair.responder.pc = new RTCPeerConnection();

                // Connect both peers
                await Promise.all([
                    connect(pair.initiator),
                    connect(pair.responder),
                ]);

                // Resolves once all candidates have been exchanged
                const allIceCandidatesExchanged = Promise.all([
                    allIceCandidatesReceived(pair.initiator),
                    allIceCandidatesReceived(pair.responder),
                ]);

                // Do initiator flow
                pair.initiator.pc.onnegotiationneeded = () => {
                    initiatorFlow(pair.initiator).then(
                        () => console.debug('Initiator flow successful'),
                        (error) => console.error('Initiator flow failed', error)
                    );
                };

                // Do responder flow
                pair.responder.pc.onnegotiationneeded = () => {
                    responderFlow(pair.responder).then(
                        () => console.debug('Responder flow successful'),
                        (error) => console.error('Responder flow failed', error)
                    );
                };

                // Set up ICE candidate handling
                setupIceCandidateHandling(pair.initiator);
                setupIceCandidateHandling(pair.responder);

                // Handover (if requested)
                if (doHandover) {
                    await Promise.all([
                        handoverToDataChannel(pair.initiator),
                        handoverToDataChannel(pair.responder),
                    ]);
                    console.info('Handover done');

                    // Wait until all candidates have been exchanged since some of the tests
                    // hijack the handed over data channel which can result in buffered candidates
                    // being exchanged after the transport has been established.
                    await allIceCandidatesExchanged;
                    console.info('All ICE candidates exchanged');
                } else {
                    // Create fake data channel so the peer connection will be kicked to life
                    jeezJustStart(pair.initiator);
                    jeezJustStart(pair.responder);
                }
            }

            it('can send offers', async (done) => {
                await connectBoth(pair, 'task');
                pair.responder.task.on('offer', (e: saltyrtc.tasks.webrtc.OfferEvent) => {
                    expect(e.type).toEqual('offer');
                    expect(e.data.type).toEqual('offer');
                    expect(e.data.sdp).toEqual('YOLO');
                    done();
                });
                pair.initiator.task.sendOffer({'type': 'offer', 'sdp': 'YOLO'});
            });

            it('can send answers', async (done) => {
                await connectBoth(pair, 'task');
                pair.initiator.task.on('answer', (e: saltyrtc.tasks.webrtc.AnswerEvent) => {
                    expect(e.type).toEqual('answer');
                    expect(e.data.type).toEqual('answer');
                    expect(e.data.sdp).toEqual('YOLO');
                    done();
                });
                pair.responder.task.sendAnswer({'type': 'answer', 'sdp': 'YOLO'});
            });

            it('can send candidates', async (done) => {
                await connectBoth(pair, 'task');

                const candidates: Array<RTCIceCandidateInit> = [
                    {'candidate': 'FOO', 'sdpMid': 'data', 'sdpMLineIndex': 0},
                    {'candidate': 'BAR', 'sdpMid': 'data', 'sdpMLineIndex': 1},
                    null,
                ];

                pair.responder.task.on('candidates', (e: saltyrtc.tasks.webrtc.CandidatesEvent) => {
                    expect(e.type).toEqual('candidates');
                    expect(Array.isArray(e.data)).toEqual(true);
                    expect(e.data.length).toEqual(candidates.length);
                    expect(e.data).toEqual(candidates);
                    done();
                });
                pair.initiator.task.sendCandidates(candidates);
            });

            it('can send buffered candidates', async (done) => {
                await connectBoth(pair, 'task');

                const candidates: Array<RTCIceCandidateInit> = [
                    {'candidate': 'FOO', 'sdpMid': 'data', 'sdpMLineIndex': 0},
                    {'candidate': 'BAR', 'sdpMid': 'data', 'sdpMLineIndex': 1},
                ];

                pair.responder.task.on('candidates', (e: saltyrtc.tasks.webrtc.CandidatesEvent) => {
                    expect(e.type).toEqual('candidates');
                    expect(Array.isArray(e.data)).toEqual(true);
                    expect(e.data.length).toEqual(candidates.length);
                    expect(e.data).toEqual(candidates);
                    done();
                });
                pair.initiator.task.sendCandidate(candidates[0]);
                pair.initiator.task.sendCandidate(candidates[1]);
            });

            it('ensure handover message not sent on data channel', async () => {
                await setupPeerConnection(pair, false);

                // Wait until all ICE candidates have been exchanged
                await Promise.all([
                    allIceCandidatesReceived(pair.initiator),
                    allIceCandidatesReceived(pair.responder),
                ]);

                // Ensure no messages are being transferred after the dust settled
                await new Promise((resolve) => setTimeout(resolve, 100));
                const messageHandler = (event: MessageEvent) => {
                    console.error('Unexpected message:', event.data);
                    fail('Unexpected message');
                };

                // Start handover process
                await Promise.all([
                    handoverToDataChannel(pair.initiator, messageHandler),
                    handoverToDataChannel(pair.responder, messageHandler),
                ]);
                await new Promise((resolve) => setTimeout(resolve, 100));
                expect(0).toBe(0);
            });

            it('can communicate on handover data channel', async () => {
                await setupPeerConnection(pair);
                expect(pair.initiator.dc.readyState).toEqual('open');
                expect(pair.responder.dc.readyState).toEqual('open');

                // Send a message back and forth
                await new Promise((resolve) => {
                    pair.responder.link.receive = (message: Uint8Array) => {
                        expect(message).toEqual(Uint8Array.of(1, 2, 3));
                        pair.responder.handler.send(Uint8Array.of(4, 5, 6));
                    };
                    pair.initiator.link.receive = (message: Uint8Array) => {
                        expect(message).toEqual(Uint8Array.of(4, 5, 6));
                        resolve();
                    };
                    pair.initiator.handler.send(Uint8Array.of(1, 2, 3));
                });

                // Make sure it's encrypted
                await new Promise((resolve) => {
                    pair.responder.dc.onmessage = (event: MessageEvent) => {
                        const array = new Uint8Array(event.data);
                        expect(array).not.toEqual(Uint8Array.of(7, 6, 7));
                        const expectedLength = 24 /* nonce */ + 9 /* chunking */ +
                            16 /* authenticator */ + 3 /* data */;
                        expect(array.byteLength).toEqual(expectedLength);
                        resolve();
                    };
                    // @ts-ignore
                    pair.initiator.task.transport.send(Uint8Array.of(7, 6, 7));
                });
            });

            it('can use a crypto context for a data channel', async () => {
                await setupPeerConnection(pair);

                // Use "raw" data channel
                await new Promise((resolve) => {
                    pair.responder.pc.ondatachannel = (event: RTCDataChannelEvent) => {
                        const dc = event.channel;
                        expect(dc.label).toEqual('french-talk');

                        // Expect unencrypted data
                        dc.onmessage = (event: MessageEvent) => {
                            expect(event.data).toEqual('bonjour');
                            resolve();
                        };
                    };
                    const dc = pair.initiator.pc.createDataChannel('french-talk');
                    dc.onopen= () => dc.send('bonjour');
                });
                console.info('Unencrypted test done');

                // Use crypto context for a data channel
                await new Promise((resolve) => {
                    const data = Uint8Array.of(1, 0, 57, 5, 9, 0);

                    // Receive data on the responder
                    pair.responder.pc.ondatachannel = (event: RTCDataChannelEvent) => {
                        const dc = event.channel;
                        expect(dc.label).toEqual('bynar-talk');
                        dc.binaryType = 'arraybuffer';

                        // Create crypto context
                        const crypto = pair.responder.task.createCryptoContext(dc.id);

                        // Expect encrypted data
                        dc.onmessage = (event: MessageEvent) => {
                            const box = saltyrtcClient.Box.fromUint8Array(
                                new Uint8Array(event.data), DataChannelCryptoContext.NONCE_LENGTH);
                            const array = crypto.decrypt(box);
                            expect(array).toEqual(data);
                            resolve();
                        };
                    };

                    // Send data via the initiator
                    {
                        const dc = pair.initiator.pc.createDataChannel('bynar-talk');
                        const crypto = pair.initiator.task.createCryptoContext(dc.id);
                        const box = crypto.encrypt(data);
                        dc.onopen = () => dc.send(box.toUint8Array());
                    }
                });
                console.info('Encrypted test done');
            });

            it('can send signaling message after handover', async () => {
                await setupPeerConnection(pair);
                expect(pair.initiator.dc.readyState).toEqual('open');
                expect(pair.responder.dc.readyState).toEqual('open');

                // Send repeated last ICE candidate to the responder and ensure it is
                // being sent via the data channel.
                await new Promise((resolve) => {
                    let receivedCount = 0;
                    pair.responder.dc.addEventListener('message', () => receivedCount++);
                    pair.responder.task.once('candidates', () => {
                        // 'message' event fires after 'candidates'...
                        setTimeout(() => {
                            expect(receivedCount).toBe(1);
                            resolve();
                        }, 1);
                    });
                    pair.initiator.task.sendCandidate({
                        candidate: pair.initiator.lastCandidate.candidate,
                        sdpMid: pair.initiator.lastCandidate.sdpMid,
                        sdpMLineIndex: pair.initiator.lastCandidate.sdpMLineIndex,
                    });
                });
            });

            it('can send application message after handover', async () => {
                await setupPeerConnection(pair);
                expect(pair.initiator.dc.readyState).toEqual('open');
                expect(pair.responder.dc.readyState).toEqual('open');

                // Send application message and ensure it is being sent via the data channel
                await new Promise((resolve) => {
                    let receivedCount = 0;
                    pair.initiator.dc.addEventListener('message', () => receivedCount++);
                    pair.initiator.signaling.once('application', (event: saltyrtc.SaltyRTCEvent) => {
                        // 'message' event fires after 'application'...
                        setTimeout(() => {
                            expect(receivedCount).toBe(1);
                            expect(event.data).toEqual('Goedendag!');
                            resolve();
                        }, 1);
                    });
                    pair.responder.signaling.sendApplicationMessage('Goedendag!')
                });
            });

            it('cannot do handover if disabled via constructor', async () => {
                pair.responder.task = new WebRTCTaskBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .withHandover(false)
                    .build();
                pair.responder.signaling = new saltyrtcClient.SaltyRTCBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                    .withKeyStore(new saltyrtcClient.KeyStore())
                    .initiatorInfo(
                        pair.initiator.signaling.permanentKeyBytes,
                        pair.initiator.signaling.authTokenBytes)
                    .usingTasks([pair.responder.task])
                    .asResponder() as saltyrtc.SaltyRTC;
                await setupPeerConnection(pair, false);

                // Ensure we cannot initiate the handover process
                const error = 'Handover has not been negotiated';
                expect(() => pair.responder.task.getTransportLink()).toThrowError(error);
                expect(() => pair.responder.task.handover(undefined)).toThrowError(error);
            });

            it('is backwards compatible to legacy v0', async () => {
                // Initiator: Offers only v0
                pair.initiator.task = new WebRTCTaskBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .withVersion('v0')
                    .withMaxChunkLength(1337)
                    .build();
                pair.initiator.signaling = new saltyrtcClient.SaltyRTCBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                    .withKeyStore(new saltyrtcClient.KeyStore())
                    .usingTasks([pair.initiator.task])
                    .asInitiator() as saltyrtc.SaltyRTC;

                // Responder: Offers v1 and v0
                const responderTaskV1 = pair.responder.task;
                pair.responder.task = new WebRTCTaskBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .withVersion('v0')
                    .build();
                pair.responder.signaling = new saltyrtcClient.SaltyRTCBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                    .withKeyStore(new saltyrtcClient.KeyStore())
                    .initiatorInfo(
                        pair.initiator.signaling.permanentKeyBytes,
                        pair.initiator.signaling.authTokenBytes)
                    .usingTasks([responderTaskV1, pair.responder.task])
                    .asResponder() as saltyrtc.SaltyRTC;

                // Ensure we can still interact just fine
                await setupPeerConnection(pair);
                expect(pair.initiator.dc.readyState).toEqual('open');
                expect(pair.responder.dc.readyState).toEqual('open');

                // Ensure the maximum chunk length (known as `max_packet_size`)
                // has been negotiated.
                // @ts-ignore
                expect(pair.initiator.task.maxChunkLength).toBe(1337);
                // @ts-ignore
                expect(pair.responder.task.maxChunkLength).toBe(1337);
            });

            it('v1 is negotiated if both v1 and v0 are provided', async () => {
                // Initiator: Offers v1 and v0 (in that order)
                const initiatorMaxChunkLength = 1337;
                pair.initiator.task = new WebRTCTaskBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .withVersion('v1')
                    .withMaxChunkLength(initiatorMaxChunkLength)
                    .build();
                const initiatorTaskV0 = new WebRTCTaskBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .withVersion('v0')
                    .withMaxChunkLength(initiatorMaxChunkLength)
                    .build();
                pair.initiator.signaling = new saltyrtcClient.SaltyRTCBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                    .withKeyStore(new saltyrtcClient.KeyStore())
                    .usingTasks([pair.initiator.task, initiatorTaskV0])
                    .asInitiator() as saltyrtc.SaltyRTC;

                // Responder: Offers v1 and v0 (in that order)
                const responderMaxChunkLength = 7331;
                pair.responder.task = new WebRTCTaskBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .withVersion('v1')
                    .withMaxChunkLength(responderMaxChunkLength)
                    .build();
                const responderTaskV0 = new WebRTCTaskBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .withVersion('v0')
                    .withMaxChunkLength(responderMaxChunkLength)
                    .build();
                pair.responder.signaling = new saltyrtcClient.SaltyRTCBuilder()
                    .withLoggingLevel(LOG_LEVEL)
                    .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
                    .withKeyStore(new saltyrtcClient.KeyStore())
                    .initiatorInfo(
                        pair.initiator.signaling.permanentKeyBytes,
                        pair.initiator.signaling.authTokenBytes)
                    .usingTasks([pair.responder.task, responderTaskV0])
                    .asResponder() as saltyrtc.SaltyRTC;

                // Ensure the v1 tasks have been chosen
                await setupPeerConnection(pair);
                expect(pair.initiator.signaling.getTask()).toBe(pair.initiator.task);
                expect(pair.responder.signaling.getTask()).toBe(pair.responder.task);

                // Ensure the maximum chunk length has NOT been negotiated
                // @ts-ignore
                expect(pair.initiator.task.maxChunkLength).toBe(initiatorMaxChunkLength);
                // @ts-ignore
                expect(pair.responder.task.maxChunkLength).toBe(responderMaxChunkLength);
                // @ts-ignore
                expect(initiatorTaskV0.maxChunkLength).toBe(initiatorMaxChunkLength);
                // @ts-ignore
                expect(responderTaskV0.maxChunkLength).toBe(responderMaxChunkLength);
            });

            function bindDataChannelEvents(role: string, dc: RTCDataChannel): void {
                // Set binary type
                dc.binaryType = 'arraybuffer';

                // Bind state events
                dc.onopen = () => console.debug(`${role} dc ${dc.id} open`);
                dc.onclose = () => console.debug(`${role} dc ${dc.id} closed`);
                dc.onerror = (error) => fail(`${role} dc ${dc.id} error: ${error}`);
            }

            class FlowControlledDataChannel {
                private readonly role: string;
                private readonly dc: RTCDataChannel;
                private readonly highWaterMark: number;
                private resolve: (value?: any | PromiseLike<any>) => void;
                private paused: boolean = false;
                private _ready: Promise<void> = Promise.resolve();

                public constructor(
                    role: string,
                    dc: RTCDataChannel,
                    lowWaterMark: number = 262144, // 256 KiB
                    highWaterMark: number = 1048576, // 1 MiB
                ) {
                    this.role = role;
                    this.dc = dc;
                    this.dc.bufferedAmountLowThreshold = lowWaterMark;
                    this.highWaterMark = highWaterMark;
                    this.dc.onbufferedamountlow = () => {
                        if (this.paused) {
                            // console.debug(`${this.role} dc ${this.dc.id} resumed @ ` +
                            //     `${this.dc.bufferedAmount}`);
                            this.paused = false;
                            this.resolve();
                        }
                    };
                }

                public get ready(): Promise<void> {
                    return this._ready;
                }

                public write(message: Uint8Array) {
                    this.dc.send(message);
                    if (!this.paused && this.dc.bufferedAmount >= this.highWaterMark) {
                        this.paused = true;
                        this._ready = new Promise((resolve) => this.resolve = resolve);
                        // console.debug(`${this.role} dc ${this.dc.id} paused @ ` +
                        //     `${this.dc.bufferedAmount}`);
                    }
                }
            }

            function testDataChannel(pair: PeerContextPair, length: number) {
                // Create message
                const message = new Uint8Array(length);
                message.fill(0xde);

                // Determine chunk length
                // Note: We need to factor in the nonce of the encrypted chunk
                const chunkLength = Math.min(pair.initiator.pc.sctp.maxMessageSize, 262144) -
                    DataChannelCryptoContext.OVERHEAD_LENGTH;
                console.debug(`Chunk length: ` +
                    `${chunkLength + DataChannelCryptoContext.OVERHEAD_LENGTH}`);

                return new Promise((resolve) => {
                    // Initiator: Create data channel
                    const dc = pair.initiator.pc.createDataChannel(`${length}`);
                    const id = dc.id;

                    // Bind state events
                    bindDataChannelEvents('initiator', dc);

                    // Initiator: Send message in chunks
                    dc.addEventListener('open', async () => {
                        // Get crypto context
                        const crypto = pair.initiator.task.createCryptoContext(dc.id);

                        // Create chunker
                        const chunker = new chunkedDc.ReliableOrderedChunker(
                            message, chunkLength, new ArrayBuffer(chunkLength));

                        // Send message in chunks (flow controlled)
                        const fcdc = new FlowControlledDataChannel('initiator', dc);
                        for (const chunk of chunker) {
                            const box = crypto.encrypt(chunk);
                            await fcdc.ready;
                            fcdc.write(box.toUint8Array());
                        }
                    }, { once: true });

                    // Responder: Receive message in chunks
                    pair.responder.pc.addEventListener('datachannel', (event: RTCDataChannelEvent) => {
                        const dc = event.channel;

                        // Ignore channels not intended for this test
                        if (dc.id !== id) {
                            return;
                        }

                        // Bind state events
                        bindDataChannelEvents('responder', dc);

                        // Get crypto context
                        const crypto = pair.initiator.task.createCryptoContext(dc.id);

                        // Create unchunker
                        const unchunker = new chunkedDc.ReliableOrderedUnchunker();

                        // Receive chunks (unfortunately not flow controlled)
                        dc.addEventListener('message', (event: MessageEvent) => {
                            const array = new Uint8Array(event.data);
                            const chunk = crypto.decrypt(saltyrtcClient.Box.fromUint8Array(
                                array, DataChannelCryptoContext.NONCE_LENGTH));
                            unchunker.add(chunk);
                        });

                        // Receive reassembled message
                        unchunker.onMessage = (message: Uint8Array) => {
                            expect(message.byteLength).toEqual(length);
                            console.info(`${length / 1024 / 1024} MiB message sending test done`);
                            resolve();
                        };
                    });
                });
            }

            it('can send arbitrary sized messages (serial)', async () => {
                await setupPeerConnection(pair);
                await testDataChannel(pair, 1024);             // 1 KiB
                await testDataChannel(pair, 1024 * 64);        // 64 KiB
                await testDataChannel(pair, 1024 * 1024);      // 1 MiB
                await testDataChannel(pair, 1024 * 256);       // 256 KiB
                await testDataChannel(pair, 1024 * 1024 * 20); // 20 MiB
                await testDataChannel(pair, 1024 * 1337);      // 1337 KiB
                await testDataChannel(pair, 1024 * 1024 * 75); // 75 MiB
            }, 120000);

            it('can send arbitrary sized messages (parallel)', async () => {
                await setupPeerConnection(pair);
                await Promise.all([
                    testDataChannel(pair, 1024),             // 1 KiB
                    testDataChannel(pair, 1024),             // 1 KiB
                    testDataChannel(pair, 1024),             // 1 KiB
                    testDataChannel(pair, 1024),             // 1 KiB
                    testDataChannel(pair, 1024),             // 1 KiB
                    testDataChannel(pair, 1024),             // 1 KiB
                    testDataChannel(pair, 1024),             // 1 KiB
                    testDataChannel(pair, 1024),             // 1 KiB
                    testDataChannel(pair, 1024 * 64),        // 64 KiB
                    testDataChannel(pair, 1024 * 64),        // 64 KiB
                    testDataChannel(pair, 1024 * 64),        // 64 KiB
                    testDataChannel(pair, 1024 * 64),        // 64 KiB
                    testDataChannel(pair, 1024 * 64),        // 64 KiB
                    testDataChannel(pair, 1024 * 64),        // 64 KiB
                    testDataChannel(pair, 1024 * 64),        // 64 KiB
                    testDataChannel(pair, 1024 * 256),       // 256 KiB
                    testDataChannel(pair, 1024 * 256),       // 256 KiB
                    testDataChannel(pair, 1024 * 256),       // 256 KiB
                    testDataChannel(pair, 1024 * 256),       // 256 KiB
                    testDataChannel(pair, 1024 * 1337),      // 1337 KiB
                    testDataChannel(pair, 1024 * 1337),      // 1337 KiB
                    testDataChannel(pair, 1024 * 1024),      // 1 MiB
                    testDataChannel(pair, 1024 * 1024),      // 1 MiB
                    testDataChannel(pair, 1024 * 1024),      // 1 MiB
                    testDataChannel(pair, 1024 * 1024),      // 1 MiB
                    testDataChannel(pair, 1024 * 1024),      // 1 MiB
                    testDataChannel(pair, 1024 * 1024 * 15), // 15 MiB
                    testDataChannel(pair, 1024 * 1024 * 30), // 30 MiB
                    testDataChannel(pair, 1024 * 1024 * 75), // 75 MiB
                ]);
            }, 120000);
        });
    });
}
