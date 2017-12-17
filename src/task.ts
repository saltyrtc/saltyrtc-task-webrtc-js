/**
 * Copyright (C) 2016-2019 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path='../saltyrtc-task-webrtc.d.ts' />

import {DataChannelCryptoContext} from "./crypto";
import {SignalingTransport} from "./transport";

/**
 * WebRTC Task Version 1.
 *
 * This task uses the end-to-end encryption techniques of SaltyRTC to set up a
 * secure WebRTC peer-to-peer connection. It also adds another security layer
 * for data channels that is available to applications. The signalling channel
 * will persist after being handed over to a dedicated data channel once the
 * peer-to-peer connection has been set up. Therefore, further signalling
 * communication between the peers does not require a dedicated WebSocket
 * connection over a SaltyRTC server.
 *
 * The task needs to be initialized with the WebRTC peer connection.
 *
 * To send offer/answer/candidates, use the corresponding public methods on
 * this task.
 */
export class WebRTCTask implements saltyrtc.tasks.webrtc.WebRTCTask {
    // Constants as defined by the specification
    private static PROTOCOL_NAME = 'v1.webrtc.tasks.saltyrtc.org';

    // Data fields
    private static FIELD_EXCLUDE = 'exclude';
    private static FIELD_HANDOVER = 'handover';

    // Other constants
    private static DC_LABEL = 'saltyrtc-signaling';

    // Logging
    private log: saltyrtc.Log;
    private logTag = '[SaltyRTC.WebRTC]';

    // Initialization state
    private initialized = false;

    // Channel ID and ID exclusion list
    private exclude: Set<number> = new Set();
    private channelId: number;

    // Signaling
    private _signaling: saltyrtc.Signaling;

    // Signalling transport
    private transportFactory: saltyrtc.tasks.webrtc.SignalingTransportFactory;
    private readonly maxChunkLength: number;
    private transport: SignalingTransport | null = null;

    // Events
    private eventRegistry: saltyrtc.EventRegistry = new saltyrtcClient.EventRegistry();

    // Candidate buffering
    private static CANDIDATE_BUFFERING_MS = 5;
    private candidates: saltyrtc.tasks.webrtc.Candidate[] = [];
    private sendCandidatesTimeout: number | null = null;

    /**
     * Create a new task instance.
     *
     * @param handover Set this parameter to a `SignalingTransportHandler`
     *   factory if you want to hand over the signalling channel to a data
     *   channel. Defaults to *no handover*.
     * @param logLevel The log level. Defaults to `none`.
     * @param maxChunkLength The maximum amount of bytes used for a chunk
     *   when fragmenting messages for a `SignalingTransportHandler`. Defaults
     *   to 256 KiB. Note that this will still obey
     *   `SignalingTransportHandler.maxMessageSize` as its upper limit.
     */
    constructor(
        handover: saltyrtc.tasks.webrtc.SignalingTransportFactory = null,
        logLevel: saltyrtc.LogLevel = 'none',
        maxChunkLength: number = 262144,
    ) {
        this.transportFactory = handover;
        this.log = new saltyrtcClient.Log(logLevel);
        this.maxChunkLength = maxChunkLength;
    }

    /**
     * Set the current signaling instance.
     */
    private set signaling(signaling: saltyrtc.Signaling) {
        this._signaling = signaling;
        this.logTag = '[SaltyRTC.WebRTC.' + signaling.role + ']';
    }

    /**
     * Get the current signaling instance.
     */
    private get signaling(): saltyrtc.Signaling {
        return this._signaling;
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Initialize the task with the task data from the peer.
     *
     * This method should only be called by the signaling class, not by the
     * application!
     */
    public init(signaling: saltyrtc.Signaling, data: Object): void {
        this.processExcludeList(data[WebRTCTask.FIELD_EXCLUDE] as number[]);
        this.processHandover(data[WebRTCTask.FIELD_HANDOVER] as boolean);
        this.signaling = signaling;
        this.initialized = true;
    }

    /**
     * The exclude field MUST contain an Array of WebRTC data channel IDs
     * (non-negative integers) that SHALL not be used for the signalling
     * channel. The client SHALL store this list for usage during handover.
     */
    private processExcludeList(ids: number[]): void {
        for (let id of ids) {
            this.exclude.add(id);
        }
        for (let i = 0; i <= 65535; i++) {
            if (!this.exclude.has(i)) {
                this.channelId = i;
                break;
            }
        }
        if (this.channelId === undefined && this.transportFactory !== null) {
            const error = 'Exclude list is too restricting, no free data channel id can be found';
            throw new Error(error);
        }
    }

    /**
     * Process the handover field from the peer.
     */
    private processHandover(handover: boolean): void {
        if (handover === false) {
            this.transportFactory = null;
        }
    }

    /**
     * Used by the signaling class to notify task that the peer handshake is over.
     *
     * This method should only be called by the signaling class, not by the application!
     */
    public onPeerHandshakeDone(): void {
        // Do nothing.
        // The application should wait for a signaling state change to TASK.
        // Then it can start by sending an offer.
    }

    /**
     * This method is called by SaltyRTC when a 'disconnected' message
     * arrives through the WebSocket.
     *
     * @param id The responder ID of the peer that disconnected.
     */
    public onDisconnected(id: number): void {
        // A 'disconnected' message arrived.
        // Notify the application.
        this.emit({type: 'disconnected', data: id});
    }

    /**
     * Handle incoming task messages.
     *
     * This method should only be called by the signaling class, not by the
     * application!
     */
    public onTaskMessage(message: saltyrtc.messages.TaskMessage): void {
        this.log.debug(this.logTag, 'New task message arrived: ' + message.type);
        switch (message.type) {
            case 'offer':
                if (this.validateOffer(message) !== true) return;
                this.emit({type: 'offer', data: message['offer']});
                break;
            case 'answer':
                if (this.validateAnswer(message) !== true) return;
                this.emit({type: 'answer', data: message['answer']});
                break;
            case 'candidates':
                if (this.validateCandidates(message) !== true) return;
                this.emit({type: 'candidates', data: message['candidates']});
                break;
            case 'handover':
                if (this.transportFactory !== null) {
                    this.log.error(this.logTag, 'Received unexpected handover message from peer');
                    this.signaling.resetConnection(saltyrtcClient.CloseCode.ProtocolError);
                    break;
                }
                if (this.signaling.handoverState.local === false) {
                    this.sendHandover();
                }
                this.signaling.handoverState.peer = true;
                if (this.signaling.handoverState.both) {
                    this.log.info(this.logTag, 'Handover to data channel finished');
                }
                break;
            default:
                this.log.error(this.logTag, 'Received message with unknown type:', message.type);
        }
    }

    /**
     * Return whether an offer message looks valid.
     */
    private validateOffer(message: saltyrtc.messages.TaskMessage): boolean {
        if (message['offer'] === undefined) {
            this.log.warn(this.logTag, 'Offer message does not contain offer');
            return false;
        }
        if (message['offer']['sdp'] === undefined) {
            this.log.warn(this.logTag, 'Offer message does not contain offer sdp');
            return false;
        }
        return true;
    }

    /**
     * Return whether an answer message looks valid.
     */
    private validateAnswer(message: saltyrtc.messages.TaskMessage): boolean {
        if (message['answer'] === undefined) {
            this.log.warn(this.logTag, 'Answer message does not contain answer');
            return false;
        }
        if (message['answer']['sdp'] === undefined) {
            this.log.warn(this.logTag, 'Answer message does not contain answer sdp');
            return false;
        }
        return true;
    }

    /**
     * Return whether a candidates message looks valid.
     */
    private validateCandidates(message: saltyrtc.messages.TaskMessage): boolean {
        if (message['candidates'] === undefined) {
            this.log.warn(this.logTag, 'Candidates message does not contain candidates');
            return false;
        }
        if ((message['candidates'] as any[]).length < 1) {
            this.log.warn(this.logTag, 'Candidates message contains empty candidate list');
            return false;
        }
        for (let candidate of message['candidates']) {
            if (candidate !== null) {
                if (typeof candidate['candidate'] !== 'string'
                    && !(candidate['candidate'] instanceof String)) {
                    this.log.warn(this.logTag,
                        'Candidates message contains invalid candidate (candidate field)');
                    return false;
                }
                if (typeof candidate['sdpMid'] !== 'string'
                    && !(candidate['sdpMid'] instanceof String) && candidate['sdpMid'] !== null) {
                    this.log.warn(this.logTag,
                        'Candidates message contains invalid candidate (sdpMid field)');
                    return false;
                }
                if (candidate['sdpMLineIndex'] !== null
                    && !Number.isInteger(candidate['sdpMLineIndex'])) {
                    this.log.warn(this.logTag,
                        'Candidates message contains invalid candidate (sdpMLineIndex field)');
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Send a signaling message through a data channel.
     *
     * This method should only be called by the signaling class, not by the
     * application!
     *
     * @param payload Non-encrypted message. The message will be encrypted by
     *   the underlying data channel.
     * @throws SignalingError when signaling or handover state are not correct.
     */
    public sendSignalingMessage(payload: Uint8Array) {
        if (this.signaling.getState() != 'task') {
            throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError,
                "Could not send signaling message: Signaling state is not 'task'.");
        }
        if (this.signaling.handoverState.local === false) {
            throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError,
                "Could not send signaling message: Handover hasn't happened yet.");
        }
        if (this.transport === null) {
            throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError,
                'Could not send signaling message: Data channel is not established, yet.');
        }
        this.transport.send(payload);
    }

    // noinspection JSMethodCanBeStatic
    /**
     * Return the task protocol name.
     */
    public getName(): string {
        return WebRTCTask.PROTOCOL_NAME;
    }

    // noinspection JSMethodCanBeStatic
    /**
     * Return the list of supported message types.
     *
     * This method should only be called by the signaling class, not by the
     * application!
     */
    public getSupportedMessageTypes(): string[] {
        return ['offer', 'answer', 'candidates', 'handover'];
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Return the task data used for negotiation in the `auth` message.
     *
     * This method should only be called by the signaling class, not by the
     * application!
     */
    public getData(): Object {
        const data = {};
        data[WebRTCTask.FIELD_EXCLUDE] = Array.from(this.exclude.values());
        data[WebRTCTask.FIELD_HANDOVER] = this.transportFactory !== null;
        return data;
    }

    /**
     * Send an offer message to the responder.
     */
    public sendOffer(offer: RTCSessionDescriptionInit): void {
        this.log.debug(this.logTag, 'Sending offer');
        try {
            this.signaling.sendTaskMessage({
                'type': 'offer',
                'offer': {
                    'type': offer.type,
                    'sdp': offer.sdp,
                }
            });
        } catch (e) {
            if (e.name === 'SignalingError') {
                this.log.error(this.logTag, 'Could not send offer:', e.message);
                this.signaling.resetConnection(e.closeCode);
            }
        }
    }

    /**
     * Send an answer message to the initiator.
     */
    public sendAnswer(answer: RTCSessionDescriptionInit): void {
        this.log.debug(this.logTag, 'Sending answer');
        try {
            this.signaling.sendTaskMessage({
                'type': 'answer',
                'answer': {
                    'type': answer.type,
                    'sdp': answer.sdp,
                }
            });
        } catch (e) {
            if (e.name === 'SignalingError') {
                this.log.error(this.logTag, 'Could not send answer:', e.message);
                this.signaling.resetConnection(e.closeCode);
            }
        }
    }

    /**
     * Send a candidate to the peer.
     */
    public sendCandidate(candidate: saltyrtc.tasks.webrtc.Candidate): void {
        this.sendCandidates([candidate]);
    }

    /**
     * Send one or more candidates to the peer.
     */
    public sendCandidates(candidates: saltyrtc.tasks.webrtc.Candidate[]): void {
        // Add to buffer
        this.log.debug(this.logTag, 'Buffering', candidates.length, 'candidate(s)');
        this.candidates.push(...candidates);

        // Sending function
        const sendFunc = () => {
            try {
                this.log.debug(this.logTag, 'Sending', this.candidates.length, 'candidate(s)');
                this.signaling.sendTaskMessage({
                    'type': 'candidates',
                    'candidates': this.candidates
                });
            } catch (e) {
                if (e.name === 'SignalingError') {
                    this.log.error(this.logTag, 'Could not send candidates:', e.message);
                    this.signaling.resetConnection(e.closeCode);
                }
            } finally {
                this.candidates = [];
                this.sendCandidatesTimeout = null;
            }
        };

        // Add a new timeout if one isn't in progress already
        if (this.sendCandidatesTimeout === null) {
            this.sendCandidatesTimeout = self.setTimeout(
                sendFunc, WebRTCTask.CANDIDATE_BUFFERING_MS);
        }
    }

    /**
     * Initiate the handover from WebSocket to a WebRTC data channel.
     *
     * Return a boolean indicating whether the handover has been initiated.
     *
     * This operation is asynchronous. To get notified when the handover is finished, subscribe to
     * the SaltyRTC `handover` event.
     */
    public handover(): boolean {
        this.log.debug(this.logTag, 'Initiate handover');

        // Make sure this is intended
        if (this.transportFactory === null) {
            this.log.error(
                this.logTag, 'Cannot do handover: Either us or remote set handover=false');
            return false;
        }

        // Make sure handover hasn't already happened
        if (this.signaling.handoverState.any) {
            this.log.error(this.logTag, 'Handover already in progress or finished');
            return false;
        }

        // Make sure the dc id is set
        if (this.channelId === undefined || this.channelId === null) {
            this.log.error(this.logTag, 'Data channel id not set');
            this.signaling.resetConnection(saltyrtcClient.CloseCode.InternalError);
            throw new Error('Data channel id not set');
        }

        // Create signalling (data) channel
        this.transportFactory(WebRTCTask.DC_LABEL, this.channelId, WebRTCTask.PROTOCOL_NAME)
            .then((dc: saltyrtc.tasks.webrtc.SignalingTransportHandler) => {
                if (this.signaling.getState() === 'task') {
                    // Create crypto context and transport
                    const crypto = this.createCryptoContext(this.channelId);
                    this.transport = new SignalingTransport(
                        dc, this, this.signaling, crypto, this.log.level, this.maxChunkLength);

                    // Send handover message
                    this.sendHandover();
                }
            })
            .catch((reason) => {
                if (this.signaling.getState() === 'task') {
                    this.log.error('Creating data channel failed, reason:', reason);
                }
            });

        // Done
        return true;
    }

    /**
     * Send a handover message to the peer.
     */
    private sendHandover(): void {
        this.log.debug(this.logTag, 'Sending handover');

        // Send handover message
        try {
            this.signaling.sendTaskMessage({'type': 'handover'});
        } catch (e) {
            if (e.name === 'SignalingError') {
                this.log.error(this.logTag, 'Could not send handover message', e.message);
                this.signaling.resetConnection(e.closeCode);
            }
        }

        // Local handover finished
        this.signaling.handoverState.local = true;

        // Check whether we're done
        if (this.signaling.handoverState.both) {
            this.log.info(this.logTag, 'Handover to data channel finished');
        }
    }

    /**
     * Return a crypto context to encrypt and decrypt data for a data channel
     * with a specific id.
     *
     * @param channelId The data channel's id.
     */
    public createCryptoContext(channelId: number): DataChannelCryptoContext {
        return new DataChannelCryptoContext(channelId, this.signaling);
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Close the signaling data channel.
     *
     * @param reason The close code.
     */
    public close(reason: number): void {
        this.log.debug(this.logTag, 'Closing signaling data channel:',
            saltyrtcClient.explainCloseCode(reason));
        if (this.transport !== null) {
            this.transport.close();
        }
        this.transport = null;
    }

    /**
     * Attach an event handler to the specified event(s).
     *
     * Note: The same event handler object be registered twice. It will only
     * run once.
     */
    public on(event: string | string[], handler: saltyrtc.SaltyRTCEventHandler): void {
        this.eventRegistry.register(event, handler);
    }

    /**
     * Attach a one-time event handler to the specified event(s).
     *
     * Note: If the same handler was already registered previously as a regular
     * event handler, it will be completely removed after running once.
     */
    public once(event: string | string[], handler: saltyrtc.SaltyRTCEventHandler): void {
        const onceHandler: saltyrtc.SaltyRTCEventHandler = (ev: saltyrtc.SaltyRTCEvent) => {
            try {
                handler(ev);
            } catch (e) {
                // Handle exceptions
                this.off(ev.type, onceHandler);
                throw e;
            }
            this.off(ev.type, onceHandler);
        };
        this.eventRegistry.register(event, onceHandler);
    }

    /**
     * Remove an event handler from the specified event(s).
     *
     * If no handler is specified, remove all handlers for the specified
     * event(s).
     *
     * If no event name is specified, all event handlers will be cleared.
     */
    public off(event?: string | string[], handler?: saltyrtc.SaltyRTCEventHandler): void {
        if (event === undefined) {
            this.eventRegistry.unregisterAll();
        } else {
            this.eventRegistry.unregister(event, handler);
        }
    }

    /**
     * Emit an event.
     */
    private emit(event: saltyrtc.SaltyRTCEvent) {
        this.log.debug(this.logTag, 'New event:', event.type);
        const handlers = this.eventRegistry.get(event.type);
        for (let handler of handlers) {
            try {
                this.callHandler(handler, event);
            } catch (e) {
                this.log.error(this.logTag, 'Unhandled exception in', event.type, 'handler:', e);
            }
        }
    }

    /**
     * Call a handler with the specified event.
     *
     * If the handler returns `false`, unregister it.
     */
    private callHandler(handler: saltyrtc.SaltyRTCEventHandler, event: saltyrtc.SaltyRTCEvent) {
        const response = handler(event);
        if (response === false) {
            this.eventRegistry.unregister(event.type, handler);
        }
    }
}
