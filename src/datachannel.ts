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

    // Events that cannot be bound via the `EventTarget` interface
    private static restrictedEventTypes = new Set(['message', 'bufferedamountlow']);

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
    private unchunker: chunkedDc.Unchunker;

    // Buffering
    private static HIGH_WATER_MARK_MIN = 1048576; // 1 MiB
    private static HIGH_WATER_MARK_MAX = 8388608; // 8 MiB
    private static LOW_WATER_MARK_RATIO = 8; // = high water mark divided by 8.
    private _onbufferedamountlow: (event: Event) => void;
    private chunkers: chunkedDc.Chunker[] = [];
    private chunkBufferedAmount = 0;
    private currentlySending = false;
    private bufferedAmountLowEventTimer: number | null = null;
    private _bufferedAmountHighTreshold: number;

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

        // Use a somewhat sane default for the high water mark
        // Note: 16 MiB seems to be the maximum buffer size in Chrome (tested on Chromium 63.0.3239.84).
        this.bufferedAmountHighTreshold = Math.min(
            Math.max(this.chunkSize * 8, SecureDataChannel.HIGH_WATER_MARK_MIN),
            SecureDataChannel.HIGH_WATER_MARK_MAX);
        this.log.debug(this.logTag, 'Set the initial high water mark to', this.bufferedAmountHighTreshold);

        // Use a somewhat sane default for the low water mark (if not already changed by the user application)
        if (this.bufferedAmountLowThreshold === 0) {
            this.bufferedAmountLowThreshold =
                Math.floor(this.bufferedAmountHighTreshold / SecureDataChannel.LOW_WATER_MARK_RATIO);
            this.log.debug(this.logTag, 'Set the initial low water mark to', this.bufferedAmountLowThreshold);
        } else {
            this.log.debug(this.logTag, 'Kept the low water mark at', this.bufferedAmountLowThreshold);
        }

        // Bind events for buffering
        this.dc.onbufferedamountlow = this.onUnderlyingBufferedAmountLow;
        if (this.chunkSize === 0) {
            this.dc.onmessage = (event: MessageEvent) => {
                this.onEncryptedMessage(event.data, [event]);
            };
        } else {
            this.dc.onmessage = this.onChunk;
            this.unchunker = new chunkedDc.Unchunker();
            this.unchunker.onMessage = this.onEncryptedMessage;
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
            // Update buffered amount and add chunker to list
            this.chunkBufferedAmount += encryptedBytes.byteLength;
            const chunker = new chunkedDc.Chunker(this.messageNumber++, encryptedBytes, this.chunkSize);
            this.chunkers.push(chunker);
        }

        // Continue sending if there is no scheduled `bufferedamountlow` event
        if (this.dc.bufferedAmount <= this.bufferedAmountLowThreshold && this.bufferedAmountLowEventTimer === null) {
            this.continueSending();
        }
    }

    private continueSending() {
        // Avoid nested calls
        if (this.currentlySending) {
            return;
        }
        this.currentlySending = true;

        // Stop scheduled timer if any (part of the workaround introduced below)
        if (this.bufferedAmountLowEventTimer !== null) {
            self.clearTimeout(this.bufferedAmountLowEventTimer);
            this.bufferedAmountLowEventTimer = null;
        }

        // Send pending chunks from chunkers
        let bufferedAmount = this.dc.bufferedAmount;
        while (this.chunkers.length > 0) {
            const chunker = this.chunkers[0];
            for (const chunk of chunker) {
                // Send chunk
                const length = chunk.byteLength;
                this.dc.send(chunk);

                // Update buffered amount
                bufferedAmount += length;
                this.chunkBufferedAmount -= length - chunkedDc.HEADER_LENGTH;

                // Pause sending if we reach the high water mark
                if (bufferedAmount >= this.bufferedAmountHighTreshold) {
                    // Schedule `bufferedamountlow` event if necessary
                    this.scheduleBufferedAmountLowEvent();

                    // Note: We do not need to remove an exhausted chunker as that will be taken
                    //       care of in the next call to this method.
                    this.currentlySending = false;
                    return;
                }
            }

            // Remove exhausted chunker
            this.chunkers.shift();
        }

        // Schedule `bufferedamountlow` event if necessary if the actual amount of bytes sent in a
        // batch went above the low water mark.
        if (bufferedAmount > this.bufferedAmountLowThreshold) {
            this.scheduleBufferedAmountLowEvent();
        }

        // Done
        this.currentlySending = false;
    }

    /**
     * Schedule firing the `bufferedamountlow` event.
     *
     * This is a workaround due to the bug that all browsers are incorrectly calculating the
     * amount of buffered data. Therefore, the `bufferedamountlow` event would not fire.
     */
    private scheduleBufferedAmountLowEvent(): void {
        // Ensure the underlying data channel implementation is below that mark, so it doesn't fire the event
        // (which is why we need to).
        if (!(this.dc.bufferedAmount < this.bufferedAmountLowThreshold)) {
            return;
        }

        // Schedule the event
        this.bufferedAmountLowEventTimer = self.setTimeout(() => {
            this.onUnderlyingBufferedAmountLow();
        }, 0);
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
        const nonce = new DataChannelNonce(this.cookiePair.ours, this.id, csn.overflow, csn.sequenceNumber);

        // Encrypt
        return this.task.getSignaling().encryptForPeer(data, nonce.toUint8Array());
    }

    /**
     * The underlying data channel is telling us it wants more data.
     */
    private onUnderlyingBufferedAmountLow = (event?: Event) => {
        // Try continue sending (and dispatch detached errors)
        try {
            this.continueSending();
        } catch (error) {
            this.log.error(this.logTag, 'Sending failed:', error);

            // Close the channel and dispatch the error to the `error` event handler.
            // Not defined in the spec but whatever. It makes sense to do it here since
            // the error is not recoverable.
            this.close();
            if (this.onerror !== undefined) {
                this.onerror.call(this.dc, error);
            }
            return;
        }

        // No event handler?
        if (this._onbufferedamountlow === undefined) {
            return;
        }

        // If the total buffered amount is low, raise the event for the application
        if (this.getTotalBufferedAmount() <= this.bufferedAmountLowThreshold) {
            if (event === undefined) {
                event = new Event('bufferedamountlow');
            }
            this._onbufferedamountlow.call(this.dc, event);
        }
    };

    /**
     * A new chunk arrived.
     */
    private onChunk = (event: MessageEvent) => {
        this.log.debug(this.logTag, 'Received chunk');

        // Ensure type is supported
        if (!(event.data instanceof ArrayBuffer)) {
            if (event.data instanceof Blob) {
                this.log.warn(this.logTag, 'Received message in blob format, which is not currently supported.');
            } else if (typeof event.data === 'string') {
                this.log.warn(this.logTag, 'Received message in string format, which is not currently supported.');
            }
            return;
        }

        // Process chunk
        this.unchunker.add(event.data as ArrayBuffer, event);

        // Clean up old chunks regularly
        if (this.chunkCount++ > SecureDataChannel.CHUNK_COUNT_GC) {
            this.unchunker.gc(SecureDataChannel.CHUNK_MAX_AGE);
            this.chunkCount = 0;
        }
    };

    private onEncryptedMessage = (data: Uint8Array, context: MessageEvent[]) => {
        // No event handler?
        if (this._onmessage === undefined) {
            return;
        }

        this.log.debug(this.logTag, 'Decrypting incoming data...');

        // Create a new MessageEvent instance based on the context of the final chunk.
        const realEvent = context[context.length - 1];
        const fakeEvent = {};
        for (let x in realEvent) {
            fakeEvent[x] = realEvent[x];
        }

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

        // Overwrite data with decoded data
        const decrypted = this.task.getSignaling().decryptFromPeer(box);
        fakeEvent['data'] = decrypted.buffer.slice(decrypted.byteOffset, decrypted.byteOffset + decrypted.byteLength);

        // Call original handler
        this._onmessage.call(this.dc, fakeEvent);
    };

    private validateNonce(nonce: DataChannelNonce) {
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
        if (nonce.channelId != this.id) {
            throw new Error("Data channel id in nonce does not match actual data channel id");
        }

        // OK!
        this.lastIncomingCsn = nonce.combinedSequenceNumber;
    }

    private getTotalBufferedAmount() {
        return this.chunkBufferedAmount + this.dc.bufferedAmount;
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
    get bufferedAmount(): number { return this.getTotalBufferedAmount(); }

    // Read/write attributes
    get bufferedAmountLowThreshold(): number {
        return this.dc.bufferedAmountLowThreshold;
    }
    set bufferedAmountLowThreshold(value: number) { this.dc.bufferedAmountLowThreshold = value; }
    get binaryType(): RTCBinaryType { return this.dc.binaryType; }
    set binaryType(value: RTCBinaryType) { this.dc.binaryType = value; }

    // Custom read/write attributes
    get bufferedAmountHighTreshold(): number { return this._bufferedAmountHighTreshold; }
    set bufferedAmountHighTreshold(value: number) {
        if (value <= 1) {
            throw 'Invalid parameter';
        }
        this._bufferedAmountHighTreshold = value;
    }

    // Event handlers
    get onopen(): EventHandler { return this.dc.onopen; }
    set onopen(handler: EventHandler) { this.dc.onopen = handler; }
    get onbufferedamountlow(): EventHandler { return this._onbufferedamountlow; }
    set onbufferedamountlow(handler: EventHandler) { this._onbufferedamountlow = handler; }
    get onerror(): EventHandler { return this.dc.onerror; }
    set onerror(value: EventHandler) { this.dc.onerror = value; }
    get onclose(): EventHandler { return this.dc.onclose; }
    set onclose(handler: EventHandler) { this.dc.onclose = handler; }
    get onmessage(): MessageEventHandler { return this._onmessage; }
    set onmessage(handler: MessageEventHandler) { this._onmessage = handler; }

    // Regular methods
    close() { this.dc.close(); }

    // EventTarget API (according to https://developer.mozilla.org/de/docs/Web/API/EventTarget)
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, useCapture?: boolean) {
        if (SecureDataChannel.restrictedEventTypes.has(type)) {
            throw new Error(`addEventListener on "${type}" events is currently not supported by SaltyRTC`);
        } else {
            this.dc.addEventListener(type, listener, useCapture);
        }
    }
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, useCapture?: boolean) {
        if (SecureDataChannel.restrictedEventTypes.has(type)) {
            throw new Error(`removeEventListener on "${type}" events is currently not supported by SaltyRTC`);
        } else {
            this.dc.removeEventListener(type, listener, useCapture);
        }
    }
    dispatchEvent(e: Event): boolean { return this.dc.dispatchEvent(e); }

}
