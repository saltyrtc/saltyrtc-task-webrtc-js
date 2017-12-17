/**
 * Copyright (C) 2016-2019 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path='../saltyrtc-task-webrtc.d.ts' />

import {ValidationError} from "./exception";
import {DataChannelNonce} from "./nonce";

/**
 * Can encrypt and decrypt data for a data channel with a specific id.
 */
export class DataChannelCryptoContext implements saltyrtc.tasks.webrtc.DataChannelCryptoContext {
    private readonly channelId: number;
    private readonly signaling: saltyrtc.Signaling;
    private readonly cookiePair: saltyrtc.CookiePair;
    private readonly csnPair: saltyrtc.CombinedSequencePair;
    private lastIncomingCsn: number = null;

    constructor(channelId: number, signaling: saltyrtc.Signaling) {
        this.channelId = channelId;
        this.signaling = signaling;
        this.cookiePair = new saltyrtcClient.CookiePair();
        this.csnPair = new saltyrtcClient.CombinedSequencePair();
    }

    public get NONCE_LENGTH(): number {
        return DataChannelNonce.TOTAL_LENGTH;
    }

    /**
     * Encrypt data to be sent on the channel.
     *
     * @param data The bytes to be encrypted.
     */
    encrypt(data: Uint8Array): saltyrtc.Box {
        // Get next outgoing CSN
        const csn: saltyrtc.NextCombinedSequence = this.csnPair.ours.next();

        // Create nonce
        const nonce = new DataChannelNonce(
            this.cookiePair.ours, this.channelId, csn.overflow, csn.sequenceNumber);

        // Encrypt data
        return this.signaling.encryptForPeer(data, nonce.toUint8Array());
    }

    /**
     * Decrypt data received on the channel.
     *
     * @param box The encrypted box.
     *
     * @throws ValidationError in case the nonce is invalid.
     */
    decrypt(box: saltyrtc.Box): Uint8Array {
        // Validate nonce
        let nonce: DataChannelNonce;
        try {
            nonce = DataChannelNonce.fromUint8Array(box.nonce);
        } catch (error) {
            throw new ValidationError(`Unable to create nonce, reason: ${error}`);
        }

        // Make sure cookies are not the same
        if (nonce.cookie.equals(this.cookiePair.ours)) {
            throw new ValidationError('Local and remote cookie are equal');
        }

        // If this is the first decrypt attempt, store peer cookie
        if (this.cookiePair.theirs === null || this.cookiePair.theirs === undefined) {
            this.cookiePair.theirs = nonce.cookie;
        }

        // Otherwise make sure the peer cookie didn't change
        else if (!nonce.cookie.equals(this.cookiePair.theirs)) {
            throw new ValidationError('Remote cookie changed');
        }

        // Make sure that two consecutive incoming messages do not have the exact same CSN
        if (this.lastIncomingCsn !== null &&
            nonce.combinedSequenceNumber === this.lastIncomingCsn) {
            throw new ValidationError('CSN reuse detected!');
        }

        // Validate data channel id
        if (nonce.channelId !== this.channelId) {
            const error = 'Data channel id in nonce does not match actual data channel id';
            throw new ValidationError(error);
        }

        // Update incoming CSN
        this.lastIncomingCsn = nonce.combinedSequenceNumber;

        // Decrypt data
        return this.signaling.decryptFromPeer(box);
    }
}
