/**
 * Copyright (C) 2016-2018 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path='../saltyrtc-task-webrtc-v2.d.ts' />
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
    private logTag = '[SaltyRTC.WebRTC.v2.SignalingTransport]';

    // Underlying data channel and associated instances
    private readonly dc: saltyrtc.tasks.webrtc.v2.SignalingTransportHandler;
    private readonly task: saltyrtc.tasks.webrtc.v2.WebRTCTask;
    private readonly signaling: saltyrtc.Signaling;
    private readonly crypto: saltyrtc.tasks.webrtc.v2.DataChannelCryptoContext;

    // Chunking
    private readonly unchunker: chunkedDc.Unchunker;

    constructor(
        dc: saltyrtc.tasks.webrtc.v2.SignalingTransportHandler,
        task: saltyrtc.tasks.webrtc.v2.WebRTCTask,
        signaling: saltyrtc.Signaling,
        crypto: saltyrtc.tasks.webrtc.v2.DataChannelCryptoContext,
        logLevel: saltyrtc.LogLevel,
    ) {
        this.log = new saltyrtcClient.Log(logLevel);
        this.dc = dc;
        this.task = task;
        this.signaling = signaling;
        this.crypto = crypto;

        // Bind transport handler events
        this.dc.onclose = this.onClose.bind(this);
        this.dc.onmessage = this.onChunk.bind(this);

        // Create realiable/ordered unchunker and bind events
        this.unchunker = new chunkedDc.Unchunker('reliable/ordered');
        this.unchunker.onMessage = this.signaling.onSignalingPeerMessage.bind(this.signaling);

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
     * Called when a message (chunk) has been received on the underlying data
     * channel.
     *
     * Each chunk will be first decrypted and then reassembled into a message.
     *
     * @param chunk The chunk bytes received.
     */
    private onChunk(chunk: Uint8Array): void {
        this.log.debug(this.logTag, 'Received chunk');

        // Decrypt chunk
        const box = saltyrtcClient.Box.fromUint8Array(chunk, this.crypto.NONCE_LENGTH);
        try {
            this.crypto.decrypt(box)
        } catch (error) {
            this.log.error(this.logTag, 'Invalid nonce:', error);
            this.log.warn(this.logTag, 'Closing data channel');

            // Close (implicitly closes the data channel as well)
            this.task.close(saltyrtcClient.CloseCode.ProtocolError);
            return;
        }

        // Decrypt chunk
        this.log.debug('Decrypting chunk');
        chunk = this.signaling.decryptFromPeer(box);

        // Process chunk
        this.unchunker.add(chunk);
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
     * This will chunk the message first and then apply encryption on each
     * individual chunk.
     *
     * @param message The signalling message to be sent.
     */
    public send(message: Uint8Array) {
        // Split message into chunks (reliable/ordered mode)
        const chunker = new chunkedDc.Chunker('reliable/ordered', this.dc.maxMessageSize);
        for (let chunk of chunker) {
            // Encrypt chunk
            const box = this.crypto.encrypt(chunk);

            // Send chunk
            this.log.debug(this.logTag, 'Sending chunk');
            this.dc.send(box.toUint8Array());
        }
    }

}
