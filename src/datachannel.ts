/**
 * Copyright (C) 2016-2018 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference types="@saltyrtc/chunked-dc" />

import * as nacl from "tweetnacl";
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
    private log: saltyrtc.Log;
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
    private chunkBuffer: ArrayBuffer;
    private unchunker: chunkedDc.UnreliableUnorderedUnchunker;

    // SaltyRTC
    private cookiePair: saltyrtc.CookiePair;
    private csnPair: saltyrtc.CombinedSequencePair;
    private lastIncomingCsn: number;

    constructor(dc: RTCDataChannel, task: WebRTCTask, logLevel: saltyrtc.LogLevel = 'none') {
        if (dc.binaryType !== 'arraybuffer') {
            throw new Error('Currently SaltyRTC can only handle data channels ' +
                'with `binaryType` set to `arraybuffer`.');
        }
        this.dc = dc;
        this.task = task;
        this.log = new saltyrtcClient.Log(logLevel);
        this.cookiePair = new saltyrtcClient.CookiePair();
        this.csnPair = new saltyrtcClient.CombinedSequencePair();

        this.chunkSize = this.task.getMaxPacketSize();
        if (this.chunkSize === null) {
            throw new Error('Could not determine max chunk size');
        }

        // Incoming dc messages are handled depending on the negotiated chunk size
        if (this.chunkSize === 0) {
            this.dc.onmessage = (event: MessageEvent) => this.onEncryptedMessage(event.data);
        } else {
            this.chunkBuffer = new ArrayBuffer(this.chunkSize);
            this.unchunker = new chunkedDc.UnreliableUnorderedUnchunker();
            this.unchunker.onMessage = this.onEncryptedMessage;
            this.dc.onmessage = this.onChunk;
        }
    }

    /**
     * Encrypt and send a message through the data channel.
     */
    public send(data: string | Blob | ArrayBuffer | ArrayBufferView): void {
        let view: Uint8Array;

        // It is most likely a Uint8Array, so we check for that first
        if (data instanceof Uint8Array) {
            view = data;
        } else if (data instanceof ArrayBuffer) {
            // Create a view of the whole buffer (don't copy)
            view = new Uint8Array(data);
        } else if (ArrayBuffer.isView(data)) {
            // Create a view of the other type's view (don't copy)
            view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        } else if (data instanceof Blob) {
            throw new Error('SecureDataChannel does not currently support Blob data. ' +
                'Please pass in an ArrayBuffer or a typed array (e.g. Uint8Array).');
        } else if (typeof data === 'string') {
            throw new Error('SecureDataChannel can only handle binary data.');
        } else {
            throw new Error('Unknown data type. Please pass in an ArrayBuffer ' +
                'or a typed array (e.g. Uint8Array).');
        }

        // Encrypt data
        // Note: The encrypted data is stored in a new buffer. Thus, there can be no side effects
        //       when modifying `data` after the call returned.
        const box: saltyrtc.Box = this.encryptData(view);
        const encryptedBytes: Uint8Array = box.toUint8Array();

        // Split into chunks if desired and send
        if (this.chunkSize === 0) {
            this.dc.send(encryptedBytes);
        } else {
            const chunker = new chunkedDc.UnreliableUnorderedChunker(
                this.messageNumber++, encryptedBytes, this.chunkSize, this.chunkBuffer);
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
        return this.task.getSignaling().encryptForPeer(data, nonce.toUint8Array());
    }

    /**
     * A new chunk arrived.
     */
    private onChunk = (event: MessageEvent) => {
        this.log.debug(this.logTag, 'Received chunk');

        // If type is not supported, exit immediately
        if (event.data instanceof Blob) {
            this.log.warn(this.logTag, 'Received message in blob format, which is not currently supported.');
            return;
        } else if (typeof event.data === 'string') {
            this.log.warn(this.logTag, 'Received message in string format, which is not currently supported.');
            return;
        }

        // Register chunk
        // Note: `event.data` can only be an ArrayBuffer instance at this point.
        this.unchunker.add(new Uint8Array(event.data as ArrayBuffer));

        // Clean up old chunks regularly
        if (this.chunkCount++ > SecureDataChannel.CHUNK_COUNT_GC) {
            this.unchunker.gc(SecureDataChannel.CHUNK_MAX_AGE);
            this.chunkCount = 0;
        }
    };

    private onEncryptedMessage = (data: Uint8Array) => {
        // If _onmessage is not defined, exit immediately.
        if (this._onmessage === undefined) {
            return;
        }
        this.log.debug(this.logTag, 'Decrypting incoming data...');
        const box = saltyrtcClient.Box.fromUint8Array(new Uint8Array(data), nacl.box.nonceLength);

        // Validate nonce
        try {
            this.validateNonce(DataChannelNonce.fromArrayBuffer(box.nonce.buffer as ArrayBuffer));
        } catch (e) {
            this.log.error(this.logTag, 'Invalid nonce:', e);
            this.log.error(this.logTag, 'Closing data channel');

            // Close this data channel
            this.close();

            // Close the signaling as well
            this.task.close(saltyrtcClient.CloseCode.ProtocolError);
            return;
        }

        // Create a fake MessageEvent where there's only the 'data' attribute
        const decrypted = this.task.getSignaling().decryptFromPeer(box);
        const fakeEvent = {
            data: decrypted.buffer.slice(decrypted.byteOffset, decrypted.byteOffset + decrypted.byteLength)
        };

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
