/**
 * Copyright (C) 2016-2019 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path='../saltyrtc-task-webrtc.d.ts' />
/// <reference types="@saltyrtc/chunked-dc" />

/**
 * Wrapper around an `SignalingTransportHandler` instance which replaces the
 * original signalling transport.
 *
 * This class handles the encryption and decryption as well as nonce
 * validation and chunking/unchunking.
 */
export class SignalingTransport {
    // Logging
    private log: saltyrtc.Log;
    private logTag = '[SaltyRTC.WebRTC.SignalingTransport]';

    // Underlying data channel and associated instances
    private readonly dc: saltyrtc.tasks.webrtc.SignalingTransportHandler;
    private readonly task: saltyrtc.tasks.webrtc.WebRTCTask;
    private readonly signaling: saltyrtc.Signaling;
    private readonly crypto: saltyrtc.tasks.webrtc.DataChannelCryptoContext;

    // Chunking
    private readonly chunkLength: number;
    private readonly chunkBuffer: ArrayBuffer;
    private readonly unchunker: chunkedDc.Unchunker;
    private messageId: number = 0;

    /**
     * Create a new signaling transport.
     *
     * @param dc The signaling transport handler this transport is being tied
     *   to.
     * @param task The WebRTC task instance.
     * @param signaling The signaling instance.
     * @param crypto A crypto context associated to the signaling transport's
     *   channel ID.
     * @param logLevel The desired log level.
     * @param maxChunkLength The maximum amount of bytes used for a chunk.
     */
    constructor(
        dc: saltyrtc.tasks.webrtc.SignalingTransportHandler,
        task: saltyrtc.tasks.webrtc.WebRTCTask,
        signaling: saltyrtc.Signaling,
        crypto: saltyrtc.tasks.webrtc.DataChannelCryptoContext,
        logLevel: saltyrtc.LogLevel,
        maxChunkLength: number,
    ) {
        this.log = new saltyrtcClient.Log(logLevel);
        this.dc = dc;
        this.task = task;
        this.signaling = signaling;
        this.crypto = crypto;
        this.chunkLength = Math.min(this.dc.maxMessageSize, maxChunkLength);
        this.chunkBuffer = new ArrayBuffer(this.chunkLength);

        // Create unchunker and bind events
        // Note: The unreliable/unordered unchunker must be used for backwards compatibility since
        //       the WebRTC task v1 has been specified with the v1.0 chunking specification.
        //       However, garbage collection is unnecessary since the channel must still be
        //       reliable and ordered.
        this.unchunker = new chunkedDc.UnreliableUnorderedUnchunker();
        this.unchunker.onMessage = this.onMessage.bind(this);

        // Bind transport handler events
        this.dc.onclose = this.onClose.bind(this);
        this.dc.onmessage = this.onChunk.bind(this);

        // Done
        this.log.info('Signaling transport established');
    }

    /**
     * Called when the underlying data channel has been closed.
     */
    private onClose(): void {
        // If handover has already happened, set the signalling state to closed
        this.log.info('Closed (remote)');
        if (this.signaling.handoverState.any) {
            this.signaling.setState('closed');
        }
    }

    /**
     * Called when a chunk has been received on the underlying data channel.
     *
     * @param chunk The chunk.
     */
    private onChunk(chunk: Uint8Array): void {
        this.log.debug(this.logTag, 'Received chunk');
        this.unchunker.add(chunk);
    }

    /**
     * Called when a message has been reassembled from chunks received on the
     * underlying data channel.
     *
     * @param message The reassembled message.
     */
    private onMessage(message: Uint8Array): void {
        this.log.debug(this.logTag, 'Received message');

        // Decrypt message
        const box = saltyrtcClient.Box.fromUint8Array(message, this.crypto.NONCE_LENGTH);
        try {
            message = this.crypto.decrypt(box)
        } catch (error) {
            this.log.error(this.logTag, 'Invalid nonce:', error);
            this.log.warn(this.logTag, 'Closing data channel');

            // Close (implicitly closes the data channel as well)
            this.task.close(saltyrtcClient.CloseCode.ProtocolError);
            return;
        }

        // Process message
        this.signaling.onSignalingPeerMessage(message);
    }

    /**
     * Close the underlying data channel and unbind from all events.
     *
     * Note: This is the final state of the transport instance. No further
     *       events will be emitted to either the task or the signalling
     *       instance after this method returned.
     */
    public close(): void {
        // Close data channel
        this.dc.close();
        this.log.info('Closed (local)');

        // Unbind transport handler events
        this.dc.onclose = undefined;
        this.dc.onmessage = undefined;

        // Unbind unchunker events
        this.unchunker.onMessage = undefined;
    }

    /**
     * Send a signalling message on the underlying channel.
     *
     * This will encrypt the message first and then fragment the message into
     * chunks.
     *
     * @param message The signalling message to be sent.
     */
    public send(message: Uint8Array) {
        this.log.debug(this.logTag, 'Sending message');

        // Encrypt message
        const box = this.crypto.encrypt(message);
        message = box.toUint8Array();

        // Split message into chunks (reliable/ordered mode)
        const chunker = new chunkedDc.UnreliableUnorderedChunker(
            this.messageId++, message, this.chunkLength, this.chunkBuffer);
        for (let chunk of chunker) {
            // Send chunk
            this.log.debug(this.logTag, 'Sending chunk');
            this.dc.send(chunk);
        }
    }
}
