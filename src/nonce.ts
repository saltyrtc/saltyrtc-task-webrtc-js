/**
 * Copyright (C) 2016-2022 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference types="@saltyrtc/client" />

/**
 * A SaltyRTC data channel nonce.
 *
 * Nonce structure:
 *
 * |CCCCCCCCCCCCCCCC|DD|OO|QQQQ|
 *
 * - C: Cookie (16 byte)
 * - D: Data channel id (2 bytes)
 * - O: Overflow number (2 bytes)
 * - Q: Sequence number (4 bytes)
 */
export class DataChannelNonce {
    public readonly cookie: saltyrtc.Cookie;
    public readonly overflow: number;
    public readonly sequenceNumber: number;
    public readonly channelId: number;

    public static TOTAL_LENGTH = 24;

    constructor(cookie: saltyrtc.Cookie, channelId: number,
                overflow: number, sequenceNumber: number) {
        this.cookie = cookie;
        this.overflow = overflow;
        this.sequenceNumber = sequenceNumber;
        this.channelId = channelId;
    }

    /**
     * Get the combined sequence number (from the sequence number and the
     * overflow number).
     */
    public get combinedSequenceNumber() {
        return (this.overflow * (2 ** 32)) + this.sequenceNumber;
    }

    /**
     * Create a nonce from a Uint8Array.
     *
     * If `data` is not exactly 24 bytes in size, throw a `ValidationError`.
     */
    public static fromUint8Array(data: Uint8Array): DataChannelNonce {
        if (data.byteLength !== this.TOTAL_LENGTH) {
            throw new saltyrtcClient.exceptions.ValidationError('Bad packet length');
        }

        // Get view to buffer
        const view = new DataView(data.buffer, data.byteOffset, this.TOTAL_LENGTH);

        // Parse and return nonce
        const slice = new Uint8Array(
            data.buffer, data.byteOffset, saltyrtcClient.Cookie.COOKIE_LENGTH);
        const cookie = new saltyrtcClient.Cookie(slice);
        const channelId = view.getUint16(16);
        const overflow = view.getUint16(18);
        const sequenceNumber = view.getUint32(20);

        return new DataChannelNonce(cookie, channelId, overflow, sequenceNumber);
    }

    /**
     * Return a Uint8Array containing the nonce data.
     */
    public toUint8Array(): Uint8Array {
        const buffer = new Uint8Array(DataChannelNonce.TOTAL_LENGTH);
        buffer.set(this.cookie.bytes);

        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        view.setUint16(16, this.channelId);
        view.setUint16(18, this.overflow);
        view.setUint32(20, this.sequenceNumber);

        return buffer;
    }
}
