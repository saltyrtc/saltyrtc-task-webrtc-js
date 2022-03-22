/**
 * Copyright (C) 2016-2022 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path="jasmine.d.ts" />
import {DataChannelNonce} from "../src/nonce";
import {DataChannelCryptoContext} from "../src/crypto";
import {SignalingTransport, SignalingTransportLink} from "../src/transport";

/**
 * Fakes the signalling and simulates a state where the task has kicked in and
 * the handover process has already been started.
 *
 * Keeps track of the state and stores received peer messages.
 */
class FakeSignaling {
    public state: saltyrtc.SignalingState = 'task';
    public handoverState: saltyrtc.HandoverState = {
        any: true,
        peer: true,
    } as saltyrtc.HandoverState;
    public messages: Array<Uint8Array> = [];

    public setState(state: saltyrtc.SignalingState): void {
        this.state = state;
    }

    public onSignalingPeerMessage(message: Uint8Array): void {
        this.messages.push(message);
    }

    // noinspection JSMethodCanBeStatic
    public encryptForPeer(data: Uint8Array, nonce: Uint8Array): saltyrtc.Box {
        // Don't actually encrypt
        return new saltyrtcClient.Box(nonce, data, DataChannelNonce.TOTAL_LENGTH);
    };

    // noinspection JSMethodCanBeStatic
    public decryptFromPeer(box: saltyrtc.Box): Uint8Array {
        // Don't actually decrypt
        return box.data;
    }
}

class FakeTask {
    public closed: boolean = false;
    public transport: SignalingTransport;

    public close() {
        this.transport.close();
        this.closed = true;
    }
}

export default () => {
    const ID = 1337;

    describe('transport', function() {
        describe('SignalingTransport', function() {
            // Defines a maximum payload size of 2 bytes per chunk
            const MAX_MESSAGE_SIZE = chunkedDc.UNRELIABLE_UNORDERED_HEADER_LENGTH + 2;

            // Expected message
            const MESSAGE = Uint8Array.of(1, 2, 3, 4, 5, 6);

            // Expected chunks (ignoring the first 12 chunks that contain the nonce)
            const CHUNKS = [
                Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 12, 1, 2),
                Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 13, 3, 4),
                Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0, 14, 5, 6),
            ];

            let fakeSignaling: FakeSignaling;
            let fakeTask: FakeTask;
            let context: saltyrtc.tasks.webrtc.DataChannelCryptoContext;

            beforeEach(() => {
                fakeSignaling = new FakeSignaling();
                fakeTask = new FakeTask();
                context = new DataChannelCryptoContext(ID, fakeSignaling as any as saltyrtc.Signaling);
            });

            const createTransport = (
                handler: saltyrtc.tasks.webrtc.SignalingTransportHandler
            ): [SignalingTransportLink, SignalingTransport] => {
                const link = new SignalingTransportLink(ID, 'fake-protocol');
                const transport = new SignalingTransport(
                    link,
                    handler,
                    fakeTask as unknown as saltyrtc.tasks.webrtc.WebRTCTask,
                    fakeSignaling as any as saltyrtc.Signaling,
                    context,
                    'debug',
                    20
                );
                fakeTask.transport = transport;
                return [link, transport];
            };

            it('binds and forwards closing', () => {
                const handler = {} as saltyrtc.tasks.webrtc.SignalingTransportHandler;
                // noinspection JSUnusedLocalSymbols
                const [link, _] = createTransport(handler);

                // Before closed
                expect(fakeSignaling.state).toBe('task');

                // Close
                link.closed();
                expect(fakeSignaling.state).toBe('closed');
            });

            it('sends a message encrypted and in chunks', () => {
                const actualChunks = [];
                // @ts-ignore
                const handler = {
                    maxMessageSize: MAX_MESSAGE_SIZE,
                    send: (chunk: Uint8Array) => actualChunks.push(chunk.slice()),
                } as saltyrtc.tasks.webrtc.SignalingTransportHandler;
                // noinspection JSUnusedLocalSymbols
                const [_, transport] = createTransport(handler);

                // Send message
                transport.send(MESSAGE);

                // Compare chunks
                expect(actualChunks.slice(12)).toEqual(CHUNKS);
            });

            it('binds, reassembles and decrypts a message', () => {
                const handler = {
                    maxMessageSize: MAX_MESSAGE_SIZE,
                } as saltyrtc.tasks.webrtc.SignalingTransportHandler;
                // noinspection JSUnusedLocalSymbols
                const [link, _] = createTransport(handler);

                // Before nonce and chunks
                expect(fakeSignaling.messages.length).toBe(0);

                // Add fake nonce
                for (let i = 0; i < 8; ++i) {
                    // Cookie
                    link.receive(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, i, 255, 255));
                }
                // Data channel id: 1337
                link.receive(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 8, 5, 57));
                // Overflow number: 0
                link.receive(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0));
                // Sequence number: 42
                link.receive(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0));
                link.receive(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 11, 0, 42));

                // Add first two chunks
                expect(fakeSignaling.messages.length).toBe(0);
                link.receive(CHUNKS[0]);
                expect(fakeSignaling.messages.length).toBe(0);
                link.receive(CHUNKS[1]);
                expect(fakeSignaling.messages.length).toBe(0);

                // Add last chunk
                link.receive(CHUNKS[2]);
                expect(fakeSignaling.messages.length).toBe(1);
                expect(fakeSignaling.messages[0]).toEqual(MESSAGE);
            });

            it('closes on error correctly', () => {
                // @ts-ignore
                const handler = {
                    maxMessageSize: MAX_MESSAGE_SIZE,
                    send: () => { throw new Error('nope') },
                    close: () => { throw new Error('still nope') },
                } as saltyrtc.tasks.webrtc.SignalingTransportHandler;
                const [link, transport] = createTransport(handler);

                // Trigger failure while sending
                transport.send(MESSAGE);

                // Ensure untied
                expect(() => link.closed()).toThrowError(
                    'closed: Not tied to a SignalingTransport');
                expect(() => link.receive(new Uint8Array(0))).toThrowError(
                    'receive: Not tied to a SignalingTransport');

                // Ensure closed
                expect(fakeTask.closed).toBeTruthy();
            });

            it('queues messages until handover requested by remote', () => {
                const handler = {
                    maxMessageSize: MAX_MESSAGE_SIZE,
                } as saltyrtc.tasks.webrtc.SignalingTransportHandler;
                fakeSignaling.handoverState.peer = false;
                // noinspection JSUnusedLocalSymbols
                const [link, transport] = createTransport(handler);

                // Before nonce and chunks
                expect(fakeSignaling.messages.length).toBe(0);

                // Add fake nonce
                for (let i = 0; i < 8; ++i) {
                    // Cookie
                    link.receive(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, i, 255, 255));
                }
                // Data channel id: 1337
                link.receive(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 8, 5, 57));
                // Overflow number: 0
                link.receive(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0));
                // Sequence number: 42
                link.receive(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0));
                link.receive(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 11, 0, 42));
                // Add all chunks
                for (const chunk of CHUNKS) {
                    link.receive(chunk);
                }

                // Expect messages to be queued
                expect(fakeSignaling.messages.length).toBe(0);
                // @ts-ignore
                expect(transport.messageQueue[0]).toEqual(MESSAGE);

                // Flush queue
                expect(() => transport.flushMessageQueue()).toThrowError(
                    'Remote did not request handover');
                fakeSignaling.handoverState.peer = true;
                transport.flushMessageQueue();

                // Expect messages to be processed now
                // @ts-ignore
                expect(transport.messageQueue).toBe(null);
                expect(fakeSignaling.messages.length).toBe(1);
                expect(fakeSignaling.messages[0]).toEqual(MESSAGE);
            });
        });
    });
}
