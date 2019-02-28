/**
 * Copyright (C) 2016-2019 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path="jasmine.d.ts" />

import {DataChannelCryptoContext} from "../src/crypto";
import {DataChannelNonce} from "../src/nonce";

const OVERHEAD_LENGTH = 40;
const NONCE_LENGTH = 24;

class FakeSignaling {
    public encryptForPeer(data: Uint8Array, nonce: Uint8Array): saltyrtc.Box {
        // Don't actually encrypt
        return new saltyrtcClient.Box(nonce, data, DataChannelNonce.TOTAL_LENGTH);
    };

    public decryptFromPeer(box: saltyrtc.Box): Uint8Array {
        // Don't actually decrypt
        return box.data;
    }
}

export default () => {
    describe('crypto', function() {
        describe('DataChannelCryptoContext', function() {
            const CHANNEL_ID = 1337;

            it('returns correct overhead and nonce length', () => {
                expect(DataChannelCryptoContext.OVERHEAD_LENGTH).toBe(OVERHEAD_LENGTH);
                expect(DataChannelCryptoContext.NONCE_LENGTH).toBe(NONCE_LENGTH);
            });

            describe('encrypt', function() {
                beforeEach(() => {
                    // @ts-ignore
                    const fakeSignaling = new FakeSignaling() as saltyrtc.Signaling;
                    this.context = new DataChannelCryptoContext(CHANNEL_ID, fakeSignaling);
                });

                it('uses expected channel id', () => {
                    for (let i = 0; i < 10; ++i) {
                        const box = this.context.encrypt(new Uint8Array(0));
                        const nonce = DataChannelNonce.fromUint8Array(box.nonce);
                        expect(nonce.channelId).toBe(CHANNEL_ID);
                    }
                });

                it('uses expected cookie', () => {
                    const cookie = this.context.cookiePair.ours.bytes;

                    for (let i = 0; i < 10; ++i) {
                        const box = this.context.encrypt(new Uint8Array(0));
                        const nonce = DataChannelNonce.fromUint8Array(box.nonce);
                        expect(nonce.cookie.bytes).toEqual(cookie);
                    }
                });

                it('uses expected combined sequence number', () => {
                    // Dirty little hack to copy the CSN
                    // Note: Will break with an API change in saltyrtc-client
                    const csn = new saltyrtcClient.CombinedSequence();
                    (csn as any).sequenceNumber = this.context.csnPair.ours.sequenceNumber;

                    for (let i = 0; i < 10; ++i) {
                        const box = this.context.encrypt(new Uint8Array(0));
                        const nonce = DataChannelNonce.fromUint8Array(box.nonce);
                        const expectedCsn = csn.next();
                        expect(nonce.overflow).toBe(expectedCsn.overflow);
                        expect(nonce.sequenceNumber).toBe(expectedCsn.sequenceNumber);
                        expect(nonce.combinedSequenceNumber).toBe(
                            expectedCsn.overflow * (2 ** 32) + expectedCsn.sequenceNumber);
                    }
                });

                it('can encrypt Uint8Array', () => {
                    const data = new Uint8Array([1, 2, 3, 4]);
                    const box = this.context.encrypt(data);
                    expect(box.data).toEqual(data);
                });

                it('can encrypt Uint8Array with offset', () => {
                    const buffer = new ArrayBuffer(12);
                    const data = new Uint8Array(buffer, 4, 4).fill(0x01);
                    const box = this.context.encrypt(data);
                    expect(box.data.byteLength).toEqual(4);
                    expect(box.data).toEqual(data);
                });
            });

            describe('decrypt', function() {
                const COOKIE = {
                    bytes: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)
                } as saltyrtc.Cookie;
                const NONCE = new DataChannelNonce(COOKIE, CHANNEL_ID, 0, 11);

                beforeEach(() => {
                    // @ts-ignore
                    const fakeSignaling = new FakeSignaling() as saltyrtc.Signaling;
                    this.context = new DataChannelCryptoContext(CHANNEL_ID, fakeSignaling);
                });

                it('rejects invalid nonce size', () => {
                    const box = { nonce: new Uint8Array(11) } as saltyrtc.Box;
                    const decrypt = () => this.context.decrypt(box);
                    expect(decrypt).toThrowError('Unable to create nonce, reason: ' +
                        'ValidationError: Bad packet length');
                });

                it('rejects cookie if local and remote cookie are identical', () => {
                    const box = this.context.encrypt(new Uint8Array(0));
                    const decrypt = () => this.context.decrypt(box);
                    expect(decrypt).toThrowError('Local and remote cookie are equal');
                });

                it('rejects cookie if modified', () => {
                    const box = {
                        nonce: NONCE.toUint8Array(), data: new Uint8Array(0)
                    } as saltyrtc.Box;

                    // Applies remote cookie
                    this.context.decrypt(box);

                    // Verifies remote cookie
                    const cookie = { bytes: new Uint8Array(16) } as saltyrtc.Cookie;
                    (box as any).nonce =
                        new DataChannelNonce(cookie, CHANNEL_ID, 0, 12).toUint8Array();
                    const decrypt = () => this.context.decrypt(box);
                    expect(decrypt).toThrowError('Remote cookie changed');
                });

                it('rejects repeated combined sequence number', () => {
                    const box = {
                        nonce: NONCE.toUint8Array(), data: new Uint8Array(0)
                    } as saltyrtc.Box;

                    // Applies remote CSN
                    this.context.decrypt(box);

                    // Verifies remote CSN
                    const decrypt = () => this.context.decrypt(box);
                    expect(decrypt).toThrowError('CSN reuse detected');
                });

                it('rejects invalid data channel id', () => {
                    const nonce = new DataChannelNonce(COOKIE, 1338, 0, 11);
                    const box = { nonce: nonce.toUint8Array(), data: new Uint8Array(0) };
                    const decrypt = () => this.context.decrypt(box);
                    expect(decrypt).toThrowError('Data channel id in nonce does not match');
                });

                it('can decrypt Uint8Array', () => {
                    const data = new Uint8Array([1, 2, 3, 4]);
                    const box = { nonce: NONCE.toUint8Array(), data: data } as saltyrtc.Box;
                    expect(this.context.decrypt(box)).toEqual(data);
                });
            });
        });
    });
}
