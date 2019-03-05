/**
 * Copyright (C) 2016-2019 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference types="@saltyrtc/client" />

declare namespace saltyrtc.tasks.webrtc {
    type Offer = RTCSessionDescriptionInit;
    type Answer = RTCSessionDescriptionInit;
    type Candidate = RTCIceCandidateInit | null;

    /**
     * A data channel's crypto context that can be used to encrypt and decrypt
     * data using the established SaltyRTC session keys for a channel with a
     * specific id.
     */
    interface DataChannelCryptoContext {
        /**
         * Encrypt data to be sent on the channel.
         *
         * @param data The bytes to be encrypted.
         */
        encrypt(data: Uint8Array): saltyrtc.Box;

        /**
         * Decrypt data received on the channel.
         *
         * @param box The encrypted box.
         *
         * @throws ValidationError in case the nonce is invalid.
         */
        decrypt(box: saltyrtc.Box): Uint8Array;
    }

    interface DataChannelCryptoContextStatic {
        /**
         * Amount of bytes added to a message being encrypted.
         */
        readonly OVERHEAD_LENGTH: number;

        /**
         * Amount of bytes used for the nonce.
         */
        readonly NONCE_LENGTH: number;
    }

    /**
     * An implementation of this handler must be provided by the application
     * in order to hand over a signalling channel to a dedicated data channel
     * controlled by the application.
     *
     * It contains a collection of functions called by the task to communicate
     * with the dedicated data channel.
     */
    interface SignalingTransportHandler {
        /**
         * Will be called to retrieve the maximum amount of bytes that can be
         * sent in a single message.
         */
        readonly maxMessageSize: number;

        /**
         * Will be called to start the closing procedure of the underlying data
         * channel.
         */
        close(): void;

        /**
         * Will be called to send a message on the underlying data channel.
         *
         * @param message A signalling message that SHALL NOT be modified
         *   or reordered by the application. It is already encrypted and
         *   obeys `maxMessageSize`. Note that `message` MUST be immediately
         *   handled or copied since the underlying buffer will be reused.
         */
        send(message: Uint8Array): void;
    }

    /**
     * Will be provided by the task and contains all necessary information
     * needed to create a dedicated data channel for the purpose of exchanging
     * signalling data.
     *
     * It also contains a collection of functions that must be called by the
     * application to forward messages and events from the dedicated data
     * channel to the task.
     */
    interface SignalingTransportLink {
        /**
         * Must be used as `label` argument when creating the `RTCDataChannel`.
         */
        readonly label: string;

        /**
         * Must be used as `id` property as part of the `RTCDataChannelInit`
         * passed for construction of an `RTCDataChannel`.
         */
        readonly id: number;

        /**
         * Must be used as `protocol` property as part of the
         * `RTCDataChannelInit` passed for construction of an `RTCDataChannel`.
         */
        readonly protocol: string;

        /**
         * Must be called when the underlying data channel has moved into the
         * `closed` state.
         */
        closed(): void;

        /**
         * Must be called when a message has been received on the underlying
         * data channel.
         *
         * @param message A signalling message whose content SHALL NOT be
         *   modified by the application before dispatching it. The application
         *   MUST consider the message as transferred after calling this.
         */
        receive(message: Uint8Array): void;
    }

    type WebRTCTaskVersion = 'v1';

    interface WebRTCTaskBuilder {
        withLoggingLevel(level: saltyrtc.LogLevel): WebRTCTaskBuilder;
        withVersion(version: WebRTCTaskVersion): WebRTCTaskBuilder;
        withHandover(on: boolean): WebRTCTaskBuilder;
        withMaxChunkLength(length: number): WebRTCTaskBuilder;
        build(): WebRTCTask;
    }

    interface WebRTCTask extends saltyrtc.Task {
        sendOffer(offer: RTCSessionDescriptionInit): void;
        sendAnswer(answer: RTCSessionDescriptionInit): void;
        sendCandidate(candidate: Candidate): void;
        sendCandidates(candidates: Candidate[]): void;
        getTransportLink(): SignalingTransportLink;
        handover(handler: SignalingTransportHandler): void;
        createCryptoContext(channelId: number): DataChannelCryptoContext;

        // Events
        on(event: string | string[], handler: saltyrtc.SaltyRTCEventHandler): void;
        once(event: string | string[], handler: saltyrtc.SaltyRTCEventHandler): void;
        off(event?: string | string[], handler?: saltyrtc.SaltyRTCEventHandler): void;
    }

    interface WebRTCTaskBuilderStatic {
        new(): WebRTCTaskBuilder;
    }

    interface OfferEvent extends saltyrtc.SaltyRTCEvent {
        data: Offer;
    }
    interface AnswerEvent extends saltyrtc.SaltyRTCEvent {
        data: Answer;
    }
    interface CandidatesEvent extends saltyrtc.SaltyRTCEvent {
        data: Candidate[];
    }
}

declare var saltyrtcTaskWebrtc: {
    WebRTCTaskBuilder: saltyrtc.tasks.webrtc.WebRTCTaskBuilderStatic,
    DataChannelCryptoContext: saltyrtc.tasks.webrtc.DataChannelCryptoContextStatic,
};
