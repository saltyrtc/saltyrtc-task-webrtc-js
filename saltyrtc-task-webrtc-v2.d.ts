/**
 * Copyright (C) 2016-2018 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference types="@saltyrtc/client" />

declare namespace saltyrtc.tasks.webrtc.v2 {

    type Offer = RTCSessionDescriptionInit;
    type Answer = RTCSessionDescriptionInit;
    type Candidate = RTCIceCandidateInit | null;

    /**
     * A data channel's crypto context that can be used to encrypt and decrypt
     * data using the established SaltyRTC session keys for a channel with a
     * specific id.
     */
    interface DataChannelCryptoContext {
        readonly NONCE_LENGTH: number;

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

    /**
     * An implementation of this handler must be provided by the application
     * in order to hand over a signalling channel to a dedicated data channel
     * controlled by the application.
     */
    interface SignalingTransportHandler {
        /**
         * The maximum amount of bytes that can be sent in a single message.
         */
        readonly maxMessageSize: number;

        /**
         * Must be called when data has been received on the underlying data
         * channel.
         *
         * @param message A signalling message whose content SHALL NOT be
         *   modified by the application before dispatching it.
         */
        onmessage: (message: Uint8Array) => void;

        /**
         * MUST be fired when the underlying data channel has moved into the
         * `closed` state.
         */
        onclose: () => void;

        /**
         * Start the closing procedure of the underlying data channel.
         */
        close(): void;

        /**
         * Send the signalling message on a data channel.
         *
         * @param message A signalling message that SHALL NOT be modified
         *   or reordered by the application. It is already encrypted and
         *   obeys `maxMessageSize`.
         */
        send(message: Uint8Array): void;
    }

    /**
     * This is a factory for the `SignalingTransportHandler` that must be
     * provided by the application in case it wants to hand over a
     * signalling channel by following the below procedure.
     *
     * The application MUST create an `RTCDataChannel` instance and with the
     * following properties:
     *
     * - `negotiated` must be `true`,
     * - `ordered` must be `true`, and
     * - further properties are `label`, `id` and `protocol` as passed to
     *   the constructor which SHALL NOT be modified by the application.
     *
     * Once the `RTCDataChannel` instance moves into the `open` state, the
     * channel SHALL be bound to an instance of a `SignalingTransportHandler`
     * that resolves the promise.
     * In case the `RTCDataChannel` instance moves into the `closed` state or
     * errors, the promise SHALL be rejected with an optional error
     * description.
     *
     * @param label The label to be used for creating the associated
     *   `RTCDataChannel`.
     * @param id The id to be used for creating the associated
     *   `RTCDataChannel`.
     * @param protocol The protocol to be used for creating the associated
     *   `RTCDataChannel`.
     */
    type SignalingTransportFactory =
        (label: string, channelId: number, protocol: string) => Promise<SignalingTransportHandler>;

    interface WebRTCTask extends saltyrtc.Task {
        sendOffer(offer: RTCSessionDescriptionInit): void;
        sendAnswer(answer: RTCSessionDescriptionInit): void;
        sendCandidate(candidate: Candidate): void;
        sendCandidates(candidates: Candidate[]): void;
        getCryptoContext(channelId: number): DataChannelCryptoContext;

        // Events
        on(event: string | string[], handler: saltyrtc.SaltyRTCEventHandler): void;
        once(event: string | string[], handler: saltyrtc.SaltyRTCEventHandler): void;
        off(event?: string | string[], handler?: saltyrtc.SaltyRTCEventHandler): void;
    }

    interface WebRTCTaskStatic {
        new(handover?: SignalingTransportFactory, logLevel?: saltyrtc.LogLevel): WebRTCTask;
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
    WebRTCTask: saltyrtc.tasks.webrtc.WebRTCTaskStatic,
};
