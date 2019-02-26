/**
 * Copyright (C) 2016-2019 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path='../saltyrtc-task-webrtc.d.ts' />
/// <reference types="@saltyrtc/chunked-dc" />

/**
 * Contains all necessary information needed to create a dedicated data channel
 * for the purpose of exchanging signalling data and to forward messages and
 * events back to the task.
 */
export class SignalingTransportLink implements saltyrtc.tasks.webrtc.SignalingTransportLink {
    // Channel info
    // noinspection JSUnusedGlobalSymbols
    public readonly label = 'saltyrtc-signaling';
    public readonly id: number;
    public readonly protocol: string;

    /**
     * Called by the application when the dedicated data channel moved into
     * the `closed` state.
     */
    public closed: () => void;

    /**
     * Called by the application when a message has been received on the
     * dedicated data channel.
     *
     * Note: The signalling `message` can be considered transferred.
     */
    public receive: (message: Uint8Array) => void;

    /**
     * Create an untied transport link.
     *
     * @param id to be used when creating the data channel
     * @param protocol to be used when creating the data channel.
     */
    public constructor(id: number, protocol: string) {
        this.id = id;
        this.protocol = protocol;
        this.untie();
    }

    /**
     * Untie the link from a `SignalingTransport` instance.
     */
    public untie() {
        this.closed = () => { throw new Error('closed: Not tied to a SignalingTransport'); };
        this.receive = () => { throw new Error('receive: Not tied to a SignalingTransport'); };
    }

    /**
     * Tie the link to a `SignalingTransport` instance.
     */
    public tie(transport: SignalingTransport) {
        this.closed = transport.closed.bind(transport);
        this.receive = transport.receiveChunk.bind(transport);
    }
}

/**
 * Replaces the original signalling transport by binding to both the task's
 * `SignalingTransportLink` and the application's `SignalingTransportHandler`.
 *
 * This class handles the encryption and decryption as well as nonce
 * validation and chunking/unchunking.
 */
export class SignalingTransport {
    // Logging
    private log: saltyrtc.Log;
    private logTag = '[SaltyRTC.WebRTC.SignalingTransport]';

    // Underlying data channel and associated instances
    private readonly link: SignalingTransportLink;
    private readonly handler: saltyrtc.tasks.webrtc.SignalingTransportHandler;
    private readonly task: saltyrtc.tasks.webrtc.WebRTCTask;
    private readonly signaling: saltyrtc.Signaling;
    private readonly crypto: saltyrtc.tasks.webrtc.DataChannelCryptoContext;

    // Chunking
    private readonly chunkLength: number;
    private readonly chunkBuffer: ArrayBuffer;
    private readonly unchunker: chunkedDc.Unchunker;
    private messageId: number = 0;

    // Incoming message queue
    private messageQueue: Array<Uint8Array> | null;

    /**
     * Create a new signaling transport.
     *
     * @param link The signalling transport link of the task.
     * @param handler The signalling transport handler of the application.
     * @param task The WebRTC task instance.
     * @param signaling The signaling instance.
     * @param crypto A crypto context associated to the signaling transport's
     *   channel ID.
     * @param logLevel The desired log level.
     * @param maxChunkLength The maximum amount of bytes used for a chunk.
     */
    constructor(
        link: SignalingTransportLink,
        handler: saltyrtc.tasks.webrtc.SignalingTransportHandler,
        task: saltyrtc.tasks.webrtc.WebRTCTask,
        signaling: saltyrtc.Signaling,
        crypto: saltyrtc.tasks.webrtc.DataChannelCryptoContext,
        logLevel: saltyrtc.LogLevel,
        maxChunkLength: number,
    ) {
        this.log = new saltyrtcClient.Log(logLevel);
        this.link = link;
        this.handler = handler;
        this.task = task;
        this.signaling = signaling;
        this.crypto = crypto;
        this.chunkLength = Math.min(this.handler.maxMessageSize, maxChunkLength);
        this.chunkBuffer = new ArrayBuffer(this.chunkLength);

        // Initialise message queue
        this.messageQueue = this.signaling.handoverState.peer ? null : [];

        // Create unchunker and bind events
        // Note: The unreliable/unordered unchunker must be used for backwards compatibility since
        //       the WebRTC task v1 has been specified with the v1.0 chunking specification.
        //       However, garbage collection is unnecessary since the channel must still be
        //       reliable and ordered.
        this.unchunker = new chunkedDc.UnreliableUnorderedUnchunker();
        this.unchunker.onMessage = this.receiveMessage.bind(this);

        // Tie to transport link
        this.link.tie(this);

        // Done
        this.log.info(this.logTag, 'Signaling transport created');
    }

    /**
     * Called when the underlying data channel has been closed.
     */
    public closed(): void {
        // If handover has already happened, set the signalling state to closed
        this.log.info('Closed (remote)');
        this.unbind();
        if (this.signaling.handoverState.any) {
            this.signaling.setState('closed');
        }
    }

    /**
     * Called when a chunk has been received on the underlying data channel.
     *
     * @param chunk The chunk. Note that the chunk MUST be considered
     *   transferred.
     */
    public receiveChunk(chunk: Uint8Array): void {
        this.log.debug(this.logTag, 'Received chunk');
        try {
            this.unchunker.add(chunk);
        } catch (error) {
            this.log.error(this.logTag, 'Invalid chunk:', error);
            return this.die();
        }
    }

    /**
     * Called when a message has been reassembled from chunks received on the
     * underlying data channel.
     *
     * @param message The reassembled message.
     */
    private receiveMessage(message: Uint8Array): void {
        this.log.debug(this.logTag, 'Received message');

        // Decrypt message
        const box = saltyrtcClient.Box.fromUint8Array(message, this.crypto.NONCE_LENGTH);
        try {
            message = this.crypto.decrypt(box)
        } catch (error) {
            this.log.error(this.logTag, 'Invalid nonce:', error);
            return this.die();
        }

        // Queue message until the transport has been acknowledged by the
        // remote peer with a handover request.
        //
        // Note: This mechanism is required to prevent reordering of messages.
        if (!this.signaling.handoverState.peer) {
            this.messageQueue.push(message);
            return;
        }

        // Process message
        this.signaling.onSignalingPeerMessage(message);
    }

    /**
     * Flush the queue of pending messages.
     *
     * This should be called once the remote peer has acknowledged the
     * transport with a handover request (i.e. a 'handover' message).
     *
     * @throws Error in case the remote peer has not requested a handover.
     */
    public flushMessageQueue(): void {
        // Ensure handover has been requested
        if (!this.signaling.handoverState.peer) {
            throw new Error('Remote did not request handover');
        }

        // Flush
        for (const message of this.messageQueue) {
            this.signaling.onSignalingPeerMessage(message);
        }

        // Remove queue
        this.messageQueue = null;
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

        // Split message into chunks (unreliable/unordered mode)
        const chunker = new chunkedDc.UnreliableUnorderedChunker(
            this.messageId++, message, this.chunkLength, this.chunkBuffer);
        for (let chunk of chunker) {
            // Send chunk
            this.log.debug(this.logTag, 'Sending chunk');
            try {
                this.handler.send(chunk);
            } catch (error) {
                this.log.error(this.logTag, 'Unable to send chunk:', error);
                return this.die();
            }
        }
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
        try {
            this.handler.close();
        } catch (error) {
            this.log.error(this.logTag, 'Unable to close data channel:', error);
        }
        this.log.info('Closed (local)');
        this.unbind();
    }

    /**
     * Closes the task abruptly due to a protocol error.
     */
    private die() {
        this.log.warn(this.logTag, 'Closing task due to an error');

        // Close (implicitly closes the data channel as well)
        this.task.close(saltyrtcClient.CloseCode.ProtocolError);
    }

    /**
     * Unbind from all events.
     */
    private unbind(): void {
        // Untie from transport link
        this.link.untie();

        // Unbind unchunker events
        this.unchunker.onMessage = undefined;
    }
}
