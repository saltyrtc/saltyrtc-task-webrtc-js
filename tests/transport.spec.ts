/**
 * Copyright (C) 2016-2019 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path="jasmine.d.ts" />
import {Box} from "@saltyrtc/client";
import {DataChannelNonce} from "../src/nonce";
import {DataChannelCryptoContext} from "../src/crypto";
import {SignalingTransport} from "../src/transport";

/**
 * Fakes the signalling and simulates a state where the task has kicked in and
 * the handover process has already been started.
 *
 * Keeps track of the state and stores received peer messages.
 */
class FakeSignaling {
    public state: saltyrtc.SignalingState = 'task';
    public messages: Array<Uint8Array> = [];

    public get handoverState(): saltyrtc.HandoverState {
        return {
            any: true,
        } as saltyrtc.HandoverState;
    }

    public setState(state: saltyrtc.SignalingState): void {
        this.state = state;
    }

    public onSignalingPeerMessage(message: Uint8Array): void {
        this.messages.push(message);
    }

    public encryptForPeer(data: Uint8Array, nonce: Uint8Array): saltyrtc.Box {
        // Don't actually encrypt
        return new Box(nonce, data, DataChannelNonce.TOTAL_LENGTH);
    };

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

            beforeEach(() => {
                // @ts-ignore
                this.fakeSignaling = new FakeSignaling() as saltyrtc.Signaling;
                // @ts-ignore
                this.fakeTask = new FakeTask() as saltyrtc.tasks.webrtc.WebRTCTask;
                this.context = new DataChannelCryptoContext(1337, this.fakeSignaling);
            });

            const createTransport = (
                handler: saltyrtc.tasks.webrtc.SignalingTransportHandler
            ): SignalingTransport => {
                const transport = new SignalingTransport(
                    handler, this.fakeTask, this.fakeSignaling, this.context, 'debug', 20);
                this.fakeTask.transport = transport;
                return transport;
            };

            it('binds and forwards closing', () => {
                const handler = {} as saltyrtc.tasks.webrtc.SignalingTransportHandler;
                createTransport(handler);

                // Before closed
                expect(this.fakeSignaling.state).toBe('task');

                // Close
                handler.onclose();
                expect(this.fakeSignaling.state).toBe('closed');
            });

            it('sends a message encrypted and in chunks', () => {
                const actualChunks = [];
                // @ts-ignore
                const handler = {
                    maxMessageSize: MAX_MESSAGE_SIZE,
                    send: (chunk: Uint8Array) => actualChunks.push(chunk.slice()),
                } as saltyrtc.tasks.webrtc.SignalingTransportHandler;
                const transport = createTransport(handler);

                // Send message
                transport.send(MESSAGE);

                // Compare chunks
                expect(actualChunks.slice(12)).toEqual(CHUNKS);
            });

            it('binds, reassembles and decrypts a message', () => {
                const handler = {
                    maxMessageSize: MAX_MESSAGE_SIZE,
                } as saltyrtc.tasks.webrtc.SignalingTransportHandler;
                createTransport(handler);

                // Before nonce and chunks
                expect(this.fakeSignaling.messages.length).toBe(0);

                // Add fake nonce
                for (let i = 0; i < 8; ++i) {
                    // Cookie
                    handler.onmessage(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, i, 255, 255));
                }
                // Data channel id: 1337
                handler.onmessage(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 8, 5, 57));
                // Overflow number: 0
                handler.onmessage(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0));
                // Sequence number: 42
                handler.onmessage(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0));
                handler.onmessage(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 11, 0, 42));

                // Add first two chunks
                expect(this.fakeSignaling.messages.length).toBe(0);
                handler.onmessage(CHUNKS[0]);
                expect(this.fakeSignaling.messages.length).toBe(0);
                handler.onmessage(CHUNKS[1]);
                expect(this.fakeSignaling.messages.length).toBe(0);

                // Add last chunk
                handler.onmessage(CHUNKS[2]);
                expect(this.fakeSignaling.messages.length).toBe(1);
                expect(this.fakeSignaling.messages[0]).toEqual(MESSAGE);
            });

            it('closes on error correctly', () => {
                // @ts-ignore
                const handler = {
                    maxMessageSize: MAX_MESSAGE_SIZE,
                    send: () => { throw new Error('nope') },
                    close: () => { throw new Error('still nope') },
                } as saltyrtc.tasks.webrtc.SignalingTransportHandler;
                const transport = createTransport(handler);

                // Ensure binds
                expect(handler.onclose).toBeDefined();
                expect(handler.onmessage).toBeDefined();

                // Trigger failure while sending
                transport.send(MESSAGE);
                expect(handler.onclose).toBeUndefined();
                expect(handler.onmessage).toBeUndefined();
                expect(this.fakeTask.closed).toBeTruthy();
            });
        });
    });
}
