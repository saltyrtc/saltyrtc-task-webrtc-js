/**
 * Copyright (C) 2016-2017 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path="jasmine.d.ts" />

import {DataChannelNonce} from "../src/nonce";
import {Cookie} from "saltyrtc-client";

export default () => { describe('nonce', function() {

    describe('DataChannelNonce', function() {

        beforeEach(() => {
            this.array = new Uint8Array([
                // Cookie
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
                // Data channel: 4370
                17, 18,
                // Overflow: 4884
                19, 20,
                // Sequence number: 84281096 big endian
                5, 6, 7, 8,
            ]);
        });

        it('parses correctly', () => {
            let nonce = DataChannelNonce.fromArrayBuffer(this.array.buffer);
            expect(nonce.cookie.bytes).toEqual(
                Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16));
            expect(nonce.channelId).toEqual((17 << 8) + 18);
            expect(nonce.overflow).toEqual((19 << 8) + 20);
            expect(nonce.sequenceNumber).toEqual((5 << 24) + (6 << 16) + (7 << 8) + 8);
        });

        it('serializes correctly', () => {
            let cookie = new Cookie(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16));
            let channel = 4370;
            let overflow = 4884;
            let sequenceNumber = 84281096;
            let nonce = new DataChannelNonce(cookie, channel, overflow, sequenceNumber);
            let buf = nonce.toArrayBuffer();
            expect(new Uint8Array(buf)).toEqual(this.array);
        });

        it('returns the correct combined sequence number', () => {
            let nonce = DataChannelNonce.fromArrayBuffer(this.array.buffer);
            expect(nonce.combinedSequenceNumber).toEqual((4884 << 32) + 84281096);
        });

    });

}); }
