/**
 * Copyright (C) 2016-2022 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path="jasmine.d.ts" />
/// <reference path="../node_modules/@saltyrtc/client/saltyrtc-client.d.ts" />

import {DataChannelNonce} from "../src/nonce";

export default () => {
    describe('nonce', function() {
        describe('DataChannelNonce', function() {
            const sourceArray = new Uint8Array([
                // Cookie
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
                // Data channel: 4370
                17, 18,
                // Overflow: 4884
                19, 20,
                // Sequence number: 84281096 big endian
                5, 6, 7, 8,
            ]);

            it('parses correctly', () => {
                const nonce = DataChannelNonce.fromUint8Array(sourceArray);
                expect(nonce.cookie.bytes).toEqual(
                    Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16));
                expect(nonce.channelId).toEqual(4370);
                expect(nonce.overflow).toEqual(4884);
                expect(nonce.sequenceNumber).toEqual(84281096);
            });

            it('serializes correctly', () => {
                const cookie = new saltyrtcClient.Cookie(
                    Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16));
                const channel = 4370;
                const overflow = 4884;
                const sequenceNumber = 84281096;
                const nonce = new DataChannelNonce(cookie, channel, overflow, sequenceNumber);
                const array = nonce.toUint8Array();
                expect(new Uint8Array(array)).toEqual(sourceArray);
            });

            it('returns the correct combined sequence number', () => {
                const nonce = DataChannelNonce.fromUint8Array(sourceArray);
                expect(nonce.combinedSequenceNumber).toEqual(20976704554760);
            });

        });
    });
}
