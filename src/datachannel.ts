/**
 * Copyright (C) 2016-2017 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference types='webrtc' />
/// <reference types='chunked-dc' />
/// <reference path='types/tweetnacl.d.ts' />

import {WebRTCTask} from "./task";
import {DataChannelNonce} from "./nonce";

type EventHandler = (event: Event) => void;
type MessageEventHandler = (event: MessageEvent) => void;

/**
 * Wrapper around a regular DataChannel.
 *
 * It will encrypt and decrypt on the fly.
 */
export class SecureDataChannel implements saltyrtc.tasks.webrtc.SecureDataChannel {

    // Logging
    private logTag = '[SaltyRTC.SecureDataChannel]';

    // Wrapped data channel
    private dc: RTCDataChannel;
    private _onmessage: (event: MessageEvent) => void;

    // Task instance
    private task: WebRTCTask;

    // Chunking
    private static CHUNK_COUNT_GC = 32;
    private static CHUNK_MAX_AGE = 60000;
    private chunkSize;
    private messageNumber = 0;
    private chunkCount = 0;
    private unchunker: chunkedDc.Unchunker;

    // SaltyRTC
    private cookiePair: saltyrtc.CookiePair;
    private csnPair: saltyrtc.CombinedSequencePair;
    private lastIncomingCsn: number;

    constructor(dc: RTCDataChannel, task: WebRTCTask) {
        if (dc.binaryType !== 'arraybuffer') {
            throw new Error('Currently SaltyRTC can only handle data channels ' +
                'with `binaryType` set to `arraybuffer`.');
        }
        this.dc = dc;
        this.task = task;
        this.cookiePair = new saltyrtcClient.CookiePair();
        this.csnPair = new saltyrtcClient.CombinedSequencePair();

        this.chunkSize = this.task.getMaxPacketSize();
        if (this.chunkSize === null) {
            throw new Error('Could not determine max chunk size');
        }

        // Incoming dc messages are handled depending on the negotiated chunk size
        if (this.chunkSize === 0) {
            this.dc.onmessage = (event: MessageEvent) => this.onEncryptedMessage(event.data, [event]);
        } else {
            this.unchunker = new chunkedDc.Unchunker();
            this.unchunker.onMessage = this.onEncryptedMessage;
            this.dc.onmessage = this.onChunk;
        }
    }

    /**
     * Encrypt and send a message through the data channel.
     */
    public send(data: string|Blob|ArrayBuffer|ArrayBufferView): void {
        // Validate input data
        let buffer: ArrayBuffer;
        if (typeof data === 'string') {
            throw new Error('SecureDataChannel can only handle binary data.');
        } else if (data instanceof Blob) {
            throw new Error('SecureDataChannel does not currently support Blob data. ' +
                'Please pass in an ArrayBuffer or a typed array (e.g. Uint8Array).');
        } else if (data instanceof Int8Array ||
            data instanceof Uint8ClampedArray ||
            data instanceof Int16Array ||
            data instanceof Uint16Array ||
            data instanceof Int32Array ||
            data instanceof Uint32Array ||
            data instanceof Float32Array ||
            data instanceof Float64Array ||
            data instanceof DataView) {
            const start = data.byteOffset || 0;
            const end = start + (data.byteLength || data.buffer.byteLength);
            buffer = data.buffer.slice(start, end);
        } else if (data instanceof Uint8Array) {
            buffer = data.buffer;
        } else if (data instanceof ArrayBuffer) {
            buffer = data;
        } else {
            throw new Error('Unknown data type. Please pass in an ArrayBuffer ' +
                'or a typed array (e.g. Uint8Array).');
        }

        // Encrypt data
        const box: saltyrtc.Box = this.encryptData(new Uint8Array(buffer));
        const encryptedBytes: Uint8Array = box.toUint8Array();

        // Split into chunks if desired and send
        if (this.chunkSize === 0) {
            this.dc.send(encryptedBytes);
        } else {
            const chunker = new chunkedDc.Chunker(this.messageNumber++, encryptedBytes, this.chunkSize);
            for (let chunk of chunker) {
                this.dc.send(chunk);
            }
        }
    }

    /**
     * Encrypt arbitrary data for the peer using the session keys.
     *
     * @param data Plain data bytes.
     * @return Encrypted box.
     */
    private encryptData(data: Uint8Array): saltyrtc.Box {
        // Get next CSN
        const csn: saltyrtc.NextCombinedSequence = this.csnPair.ours.next();

        // Create nonce
        const nonce = new DataChannelNonce(this.cookiePair.ours, this.dc.id, csn.overflow, csn.sequenceNumber);

        // Encrypt
        const encrypted = this.task.getSignaling().encryptForPeer(data, nonce.toUint8Array());
        return encrypted;
    }

    /**
     * A new chunk arrived.
     */
    private onChunk = (event: MessageEvent) => {
        console.debug(this.logTag, 'Received chunk');

        // If type is not supported, exit immediately
        if (event.data instanceof Blob) {
            console.warn(this.logTag, 'Received message in blob format, which is not currently supported.');
            return;
        } else if (typeof event.data == 'string') {
            console.warn(this.logTag, 'Received message in string format, which is not currently supported.');
            return;
        } else if (!(event.data instanceof ArrayBuffer)) {
            console.warn(this.logTag, 'Received message in unsupported format. Please send ArrayBuffer objects.');
            return;
        }

        // Register chunk
        this.unchunker.add(event.data as ArrayBuffer, event);

        // Clean up old chunks regularly
        if (this.chunkCount++ > SecureDataChannel.CHUNK_COUNT_GC) {
            this.unchunker.gc(SecureDataChannel.CHUNK_MAX_AGE);
            this.chunkCount = 0;
        }
    };

    private onEncryptedMessage = (data: Uint8Array, context: MessageEvent[]) => {
        // If _onmessage is not defined, exit immediately.
        if (this._onmessage === undefined) {
            return;
        }

        console.debug(this.logTag, 'Decrypting incoming data...');

        // Create a new MessageEvent instance based on the context of the final chunk.
        const realEvent = context[context.length - 1];
        const fakeEvent = {};
        for (let x in realEvent) {
            fakeEvent[x] = realEvent[x];
        }

        const box = saltyrtcClient.Box.fromUint8Array(new Uint8Array(data), nacl.box.nonceLength);

        // Validate nonce
        try {
            this.validateNonce(DataChannelNonce.fromArrayBuffer(box.nonce.buffer));
        } catch (e) {
            console.error(this.logTag, 'Invalid nonce:', e);
            console.error(this.logTag, 'Closing data channel');

            // Close this data channel
            this.close();

            // Close the signaling as well
            this.task.close(saltyrtcClient.CloseCode.ProtocolError);

            return;
        }

        // Overwrite data with decoded data
        const decrypted = this.task.getSignaling().decryptFromPeer(box);
        fakeEvent['data'] = decrypted.buffer.slice(decrypted.byteOffset, decrypted.byteOffset + decrypted.byteLength);

        // Call original handler
        this._onmessage.bind(this.dc)(fakeEvent);
    };

    private validateNonce(nonce: DataChannelNonce):void {
        // Make sure cookies are not the same
        if (nonce.cookie.equals(this.cookiePair.ours)) {
            throw new Error('Local and remote cookie are equal');
        }

        // If this is the first message, store peer cookie
        if (this.cookiePair.theirs === null || this.cookiePair.theirs === undefined) {
            this.cookiePair.theirs = nonce.cookie;
        }

        // Otherwise make sure the peer cookie didn't change
        else if (!nonce.cookie.equals(this.cookiePair.theirs)) {
            throw new Error("Remote cookie changed");
        }

        // Make sure that two consecutive incoming messages do not have the exact same CSN
        if (this.lastIncomingCsn != null && nonce.combinedSequenceNumber == this.lastIncomingCsn) {
            throw new Error("CSN reuse detected!");
        }

        // Validate data channel id
        if (nonce.channelId != this.dc.id) {
            throw new Error("Data channel id in nonce does not match actual data channel id");
        }

        // OK!
        this.lastIncomingCsn = nonce.combinedSequenceNumber;
    }

    // Readonly attributes
    get label(): string { return this.dc.label; }
    get ordered(): boolean { return this.dc.ordered; }
    get maxPacketLifeTime(): number { return this.dc.maxPacketLifeTime; }
    get maxRetransmits(): number { return this.dc.maxRetransmits; }
    get protocol(): string { return this.dc.protocol; }
    get negotiated(): boolean { return this.dc.negotiated; }
    get id(): number { return this.dc.id; }
    get readyState(): RTCDataChannelState { return this.dc.readyState; }
    get bufferedAmount(): number { return this.dc.bufferedAmount; }

    // Read/write attributes
    get bufferedAmountLowThreshold(): number { return this.dc.bufferedAmountLowThreshold; }
    set bufferedAmountLowThreshold(value: number) { this.dc.bufferedAmountLowThreshold = value; }
    get binaryType(): RTCBinaryType { return this.dc.binaryType; }
    set binaryType(value: RTCBinaryType) { this.dc.binaryType = value; }

    // Event handlers
    get onopen(): EventHandler { return this.dc.onopen; }
    set onopen(value: EventHandler) { this.dc.onopen = value; }
    get onbufferedamountlow(): EventHandler { return this.dc.onbufferedamountlow; }
    set onbufferedamountlow(value: EventHandler) { this.dc.onbufferedamountlow = value; }
    get onerror(): EventHandler { return this.dc.onerror; }
    set onerror(value: EventHandler) { this.dc.onerror = value; }
    get onclose(): EventHandler { return this.dc.onclose; }
    set onclose(value: EventHandler) { this.dc.onclose = value; }
    get onmessage(): MessageEventHandler { return this.dc.onmessage; }
    set onmessage(value: MessageEventHandler) { this._onmessage = value; }

    // Regular methods
    close(): void { this.dc.close(); }

    // EventTarget API (according to https://developer.mozilla.org/de/docs/Web/API/EventTarget)
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, useCapture?: boolean): void {
        if (type === 'message') {
            throw new Error('addEventListener on message events is not currently supported by SaltyRTC.');
        } else {
            this.dc.addEventListener(type, listener, useCapture);
        }
    }
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, useCapture?: boolean): void {
        if (type === 'message') {
            throw new Error('removeEventListener on message events is not currently supported by SaltyRTC.');
        } else {
            this.dc.removeEventListener(type, listener, useCapture);
        }
    }
    dispatchEvent(e: Event): boolean { return this.dc.dispatchEvent(e); }

}
