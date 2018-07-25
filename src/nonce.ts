/**
 * Copyright (C) 2016-2018 Threema GmbH
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
    private _cookie: saltyrtc.Cookie;
    private _overflow: number;
    private _sequenceNumber: number;
    private _channelId: number;

    public static TOTAL_LENGTH = 24;

    constructor(cookie: saltyrtc.Cookie, channelId: number, overflow: number, sequenceNumber: number) {
        this._cookie = cookie;
        this._overflow = overflow;
        this._sequenceNumber = sequenceNumber;
        this._channelId = channelId;
    }

    get cookie() { return this._cookie; }
    get overflow() { return this._overflow; }
    get sequenceNumber() { return this._sequenceNumber; }
    get combinedSequenceNumber() { return (this._overflow << 32) + this._sequenceNumber; }
    get channelId() { return this._channelId; }

    /**
     * Create a nonce from an ArrayBuffer.
     *
     * If packet is not exactly 24 bytes long, throw an exception.
     */
    public static fromArrayBuffer(packet: ArrayBuffer): DataChannelNonce {
        if (packet.byteLength != DataChannelNonce.TOTAL_LENGTH) {
            throw 'bad-packet-length';
        }

        // Get view to buffer
        const view = new DataView(packet);

        // Parse and return nonce
        const cookie = new saltyrtcClient.Cookie(new Uint8Array(packet, 0, 16));
        const channelId = view.getUint16(16);
        const overflow = view.getUint16(18);
        const sequenceNumber = view.getUint32(20);

        return new DataChannelNonce(cookie, channelId, overflow, sequenceNumber);
    }

    /**
     * Return an ArrayBuffer containing the nonce data.
     */
    public toArrayBuffer(): ArrayBuffer {
        const buf = new ArrayBuffer(DataChannelNonce.TOTAL_LENGTH);

        const uint8view = new Uint8Array(buf);
        uint8view.set(this._cookie.bytes);

        const view = new DataView(buf);
        view.setUint16(16, this._channelId);
        view.setUint16(18, this._overflow);
        view.setUint32(20, this._sequenceNumber);

        return buf;
    }

    /**
     * Return an Uint8Array containing the nonce data.
     */
    public toUint8Array(): Uint8Array {
        return new Uint8Array(this.toArrayBuffer());
    }

}
