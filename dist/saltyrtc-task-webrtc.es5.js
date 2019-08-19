/**
 * saltyrtc-task-webrtc v0.14.1
 * A SaltyRTC WebRTC task v1 implementation.
 * https://github.com/saltyrtc/saltyrtc-task-webrtc-js#readme
 *
 * Copyright (C) 2016-2019 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license:
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
'use strict';

var saltyrtcTaskWebrtc = (function (exports) {
  'use strict';

  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }

  function _defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, descriptor.key, descriptor);
    }
  }

  function _createClass(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps);
    if (staticProps) _defineProperties(Constructor, staticProps);
    return Constructor;
  }

  function _toConsumableArray(arr) {
    return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _nonIterableSpread();
  }

  function _arrayWithoutHoles(arr) {
    if (Array.isArray(arr)) {
      for (var i = 0, arr2 = new Array(arr.length); i < arr.length; i++) arr2[i] = arr[i];

      return arr2;
    }
  }

  function _iterableToArray(iter) {
    if (Symbol.iterator in Object(iter) || Object.prototype.toString.call(iter) === "[object Arguments]") return Array.from(iter);
  }

  function _nonIterableSpread() {
    throw new TypeError("Invalid attempt to spread non-iterable instance");
  }

  var DataChannelNonce =
  /*#__PURE__*/
  function () {
    function DataChannelNonce(cookie, channelId, overflow, sequenceNumber) {
      _classCallCheck(this, DataChannelNonce);

      this.cookie = cookie;
      this.overflow = overflow;
      this.sequenceNumber = sequenceNumber;
      this.channelId = channelId;
    }

    _createClass(DataChannelNonce, [{
      key: "toUint8Array",
      value: function toUint8Array() {
        var buffer = new Uint8Array(DataChannelNonce.TOTAL_LENGTH);
        buffer.set(this.cookie.bytes);
        var view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        view.setUint16(16, this.channelId);
        view.setUint16(18, this.overflow);
        view.setUint32(20, this.sequenceNumber);
        return buffer;
      }
    }, {
      key: "combinedSequenceNumber",
      get: function get() {
        return this.overflow * Math.pow(2, 32) + this.sequenceNumber;
      }
    }], [{
      key: "fromUint8Array",
      value: function fromUint8Array(data) {
        if (data.byteLength !== this.TOTAL_LENGTH) {
          throw new saltyrtcClient.exceptions.ValidationError('Bad packet length');
        }

        var view = new DataView(data.buffer, data.byteOffset, this.TOTAL_LENGTH);
        var slice = new Uint8Array(data.buffer, data.byteOffset, saltyrtcClient.Cookie.COOKIE_LENGTH);
        var cookie = new saltyrtcClient.Cookie(slice);
        var channelId = view.getUint16(16);
        var overflow = view.getUint16(18);
        var sequenceNumber = view.getUint32(20);
        return new DataChannelNonce(cookie, channelId, overflow, sequenceNumber);
      }
    }]);

    return DataChannelNonce;
  }();

  DataChannelNonce.TOTAL_LENGTH = 24;

  var DataChannelCryptoContext =
  /*#__PURE__*/
  function () {
    function DataChannelCryptoContext(channelId, signaling) {
      _classCallCheck(this, DataChannelCryptoContext);

      this.lastIncomingCsn = null;
      this.channelId = channelId;
      this.signaling = signaling;
      this.cookiePair = new saltyrtcClient.CookiePair();
      this.csnPair = new saltyrtcClient.CombinedSequencePair();
    }

    _createClass(DataChannelCryptoContext, [{
      key: "encrypt",
      value: function encrypt(data) {
        var csn = this.csnPair.ours.next();
        var nonce = new DataChannelNonce(this.cookiePair.ours, this.channelId, csn.overflow, csn.sequenceNumber);
        return this.signaling.encryptForPeer(data, nonce.toUint8Array());
      }
    }, {
      key: "decrypt",
      value: function decrypt(box) {
        var nonce;

        try {
          nonce = DataChannelNonce.fromUint8Array(box.nonce);
        } catch (error) {
          throw new saltyrtcClient.exceptions.ValidationError("Unable to create nonce, reason: ".concat(error));
        }

        if (nonce.cookie.equals(this.cookiePair.ours)) {
          throw new saltyrtcClient.exceptions.ValidationError('Local and remote cookie are equal');
        }

        if (this.cookiePair.theirs === null || this.cookiePair.theirs === undefined) {
          this.cookiePair.theirs = nonce.cookie;
        } else if (!nonce.cookie.equals(this.cookiePair.theirs)) {
          throw new saltyrtcClient.exceptions.ValidationError('Remote cookie changed');
        }

        if (this.lastIncomingCsn !== null && nonce.combinedSequenceNumber === this.lastIncomingCsn) {
          throw new saltyrtcClient.exceptions.ValidationError('CSN reuse detected');
        }

        if (nonce.channelId !== this.channelId) {
          var error = 'Data channel id in nonce does not match';
          throw new saltyrtcClient.exceptions.ValidationError(error);
        }

        this.lastIncomingCsn = nonce.combinedSequenceNumber;
        return this.signaling.decryptFromPeer(box);
      }
    }]);

    return DataChannelCryptoContext;
  }();

  DataChannelCryptoContext.OVERHEAD_LENGTH = 40;
  DataChannelCryptoContext.NONCE_LENGTH = DataChannelNonce.TOTAL_LENGTH;

  var SignalingTransportLink =
  /*#__PURE__*/
  function () {
    function SignalingTransportLink(id, protocol) {
      _classCallCheck(this, SignalingTransportLink);

      this.label = 'saltyrtc-signaling';
      this.id = id;
      this.protocol = protocol;
      this.untie();
    }

    _createClass(SignalingTransportLink, [{
      key: "untie",
      value: function untie() {
        this.closed = function () {
          throw new Error('closed: Not tied to a SignalingTransport');
        };

        this.receive = function () {
          throw new Error('receive: Not tied to a SignalingTransport');
        };
      }
    }, {
      key: "tie",
      value: function tie(transport) {
        this.closed = transport.closed.bind(transport);
        this.receive = transport.receiveChunk.bind(transport);
      }
    }]);

    return SignalingTransportLink;
  }();

  var SignalingTransport =
  /*#__PURE__*/
  function () {
    function SignalingTransport(link, handler, task, signaling, crypto, logLevel, maxChunkLength) {
      _classCallCheck(this, SignalingTransport);

      this.logTag = '[SaltyRTC.WebRTC.SignalingTransport]';
      this.messageId = 0;
      this.log = new saltyrtcClient.Log(logLevel);
      this.link = link;
      this.handler = handler;
      this.task = task;
      this.signaling = signaling;
      this.crypto = crypto;
      this.chunkLength = Math.min(this.handler.maxMessageSize, maxChunkLength);
      this.chunkBuffer = new ArrayBuffer(this.chunkLength);
      this.messageQueue = this.signaling.handoverState.peer ? null : [];
      this.unchunker = new chunkedDc.UnreliableUnorderedUnchunker();
      this.unchunker.onMessage = this.receiveMessage.bind(this);
      this.link.tie(this);
      this.log.info(this.logTag, 'Signaling transport created');
    }

    _createClass(SignalingTransport, [{
      key: "closed",
      value: function closed() {
        this.log.info('Closed (remote)');
        this.unbind();

        if (this.signaling.handoverState.any) {
          this.signaling.setState('closed');
        }
      }
    }, {
      key: "receiveChunk",
      value: function receiveChunk(chunk) {
        this.log.debug(this.logTag, 'Received chunk');

        try {
          this.unchunker.add(chunk);
        } catch (error) {
          this.log.error(this.logTag, 'Invalid chunk:', error);
          return this.die();
        }
      }
    }, {
      key: "receiveMessage",
      value: function receiveMessage(message) {
        this.log.debug(this.logTag, 'Received message');
        var box = saltyrtcClient.Box.fromUint8Array(message, DataChannelCryptoContext.NONCE_LENGTH);

        try {
          message = this.crypto.decrypt(box);
        } catch (error) {
          this.log.error(this.logTag, 'Invalid nonce:', error);
          return this.die();
        }

        if (!this.signaling.handoverState.peer) {
          this.messageQueue.push(message);
          return;
        }

        this.signaling.onSignalingPeerMessage(message);
      }
    }, {
      key: "flushMessageQueue",
      value: function flushMessageQueue() {
        if (!this.signaling.handoverState.peer) {
          throw new Error('Remote did not request handover');
        }

        var _iteratorNormalCompletion = true;
        var _didIteratorError = false;
        var _iteratorError = undefined;

        try {
          for (var _iterator = this.messageQueue[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
            var message = _step.value;
            this.signaling.onSignalingPeerMessage(message);
          }
        } catch (err) {
          _didIteratorError = true;
          _iteratorError = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion && _iterator.return != null) {
              _iterator.return();
            }
          } finally {
            if (_didIteratorError) {
              throw _iteratorError;
            }
          }
        }

        this.messageQueue = null;
      }
    }, {
      key: "send",
      value: function send(message) {
        this.log.debug(this.logTag, 'Sending message');
        var box = this.crypto.encrypt(message);
        message = box.toUint8Array();
        var chunker = new chunkedDc.UnreliableUnorderedChunker(this.messageId++, message, this.chunkLength, this.chunkBuffer);
        var _iteratorNormalCompletion2 = true;
        var _didIteratorError2 = false;
        var _iteratorError2 = undefined;

        try {
          for (var _iterator2 = chunker[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
            var chunk = _step2.value;
            this.log.debug(this.logTag, 'Sending chunk');

            try {
              this.handler.send(chunk);
            } catch (error) {
              this.log.error(this.logTag, 'Unable to send chunk:', error);
              return this.die();
            }
          }
        } catch (err) {
          _didIteratorError2 = true;
          _iteratorError2 = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion2 && _iterator2.return != null) {
              _iterator2.return();
            }
          } finally {
            if (_didIteratorError2) {
              throw _iteratorError2;
            }
          }
        }
      }
    }, {
      key: "close",
      value: function close() {
        try {
          this.handler.close();
        } catch (error) {
          this.log.error(this.logTag, 'Unable to close data channel:', error);
        }

        this.log.info('Closed (local)');
        this.unbind();
      }
    }, {
      key: "die",
      value: function die() {
        this.log.warn(this.logTag, 'Closing task due to an error');
        this.task.close(saltyrtcClient.CloseCode.ProtocolError);
      }
    }, {
      key: "unbind",
      value: function unbind() {
        this.link.untie();
        this.unchunker.onMessage = undefined;
      }
    }]);

    return SignalingTransport;
  }();

  var WebRTCTaskBuilder =
  /*#__PURE__*/
  function () {
    function WebRTCTaskBuilder() {
      _classCallCheck(this, WebRTCTaskBuilder);

      this.version = 'v1';
      this.logLevel = 'none';
      this.handover = true;
      this.maxChunkLength = 262144;
    }

    _createClass(WebRTCTaskBuilder, [{
      key: "withLoggingLevel",
      value: function withLoggingLevel(level) {
        this.logLevel = level;
        return this;
      }
    }, {
      key: "withVersion",
      value: function withVersion(version) {
        this.version = version;
        return this;
      }
    }, {
      key: "withHandover",
      value: function withHandover(on) {
        this.handover = on;
        return this;
      }
    }, {
      key: "withMaxChunkLength",
      value: function withMaxChunkLength(length) {
        if (length <= chunkedDc.UNRELIABLE_UNORDERED_HEADER_LENGTH) {
          throw new Error('Maximum chunk length must be greater than chunking overhead');
        }

        this.maxChunkLength = length;
        return this;
      }
    }, {
      key: "build",
      value: function build() {
        return new WebRTCTask(this.version, this.logLevel, this.handover, this.maxChunkLength);
      }
    }]);

    return WebRTCTaskBuilder;
  }();

  var WebRTCTask =
  /*#__PURE__*/
  function () {
    function WebRTCTask(version, logLevel, handover, maxChunkLength) {
      _classCallCheck(this, WebRTCTask);

      this.logTag = '[SaltyRTC.WebRTC]';
      this.initialized = false;
      this.exclude = new Set();
      this.link = null;
      this.transport = null;
      this.eventRegistry = new saltyrtcClient.EventRegistry();
      this.candidates = [];
      this.sendCandidatesTimeout = null;
      this.version = version;
      this.log = new saltyrtcClient.Log(logLevel);
      this.doHandover = handover;
      this.maxChunkLength = maxChunkLength;
    }

    _createClass(WebRTCTask, [{
      key: "init",
      value: function init(signaling, data) {
        this.processExcludeList(data[WebRTCTask.FIELD_EXCLUDE]);
        this.processHandover(data[WebRTCTask.FIELD_HANDOVER]);

        if (this.version === 'v0') {
          this.processMaxPacketSize(data[WebRTCTask.FIELD_MAX_PACKET_SIZE]);
        }

        this.signaling = signaling;
        this.initialized = true;
      }
    }, {
      key: "processExcludeList",
      value: function processExcludeList(ids) {
        var _iteratorNormalCompletion = true;
        var _didIteratorError = false;
        var _iteratorError = undefined;

        try {
          for (var _iterator = ids[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
            var id = _step.value;
            this.exclude.add(id);
          }
        } catch (err) {
          _didIteratorError = true;
          _iteratorError = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion && _iterator.return != null) {
              _iterator.return();
            }
          } finally {
            if (_didIteratorError) {
              throw _iteratorError;
            }
          }
        }

        for (var i = 0; i < 65535; i++) {
          if (!this.exclude.has(i)) {
            this.channelId = i;
            break;
          }
        }

        if (this.channelId === undefined && this.doHandover) {
          throw new Error('No free data channel id can be found');
        }
      }
    }, {
      key: "processHandover",
      value: function processHandover(handover) {
        if (handover === false) {
          this.doHandover = false;
        }
      }
    }, {
      key: "processMaxPacketSize",
      value: function processMaxPacketSize(remoteMaxPacketSize) {
        var localMaxPacketSize = this.maxChunkLength;

        if (!Number.isInteger(remoteMaxPacketSize)) {
          throw new RangeError(WebRTCTask.FIELD_MAX_PACKET_SIZE + ' field must be an integer');
        }

        if (remoteMaxPacketSize < 0) {
          throw new RangeError(WebRTCTask.FIELD_MAX_PACKET_SIZE + ' field must be positive');
        } else if (remoteMaxPacketSize > 0) {
          this.maxChunkLength = Math.min(localMaxPacketSize, remoteMaxPacketSize);
        }

        this.log.debug(this.logTag, "Max packet size: Local requested ".concat(localMaxPacketSize) + " bytes, remote requested ".concat(remoteMaxPacketSize, " bytes. Using ").concat(this.maxChunkLength, "."));
      }
    }, {
      key: "onPeerHandshakeDone",
      value: function onPeerHandshakeDone() {}
    }, {
      key: "onDisconnected",
      value: function onDisconnected(id) {
        this.emit({
          type: 'disconnected',
          data: id
        });
      }
    }, {
      key: "onTaskMessage",
      value: function onTaskMessage(message) {
        this.log.debug(this.logTag, 'New task message arrived: ' + message.type);

        switch (message.type) {
          case 'offer':
            if (this.validateOffer(message) !== true) return;
            this.emit({
              type: 'offer',
              data: message['offer']
            });
            break;

          case 'answer':
            if (this.validateAnswer(message) !== true) return;
            this.emit({
              type: 'answer',
              data: message['answer']
            });
            break;

          case 'candidates':
            if (this.validateCandidates(message) !== true) return;
            this.emit({
              type: 'candidates',
              data: message['candidates']
            });
            break;

          case 'handover':
            if (!this.doHandover) {
              this.log.error(this.logTag, 'Received unexpected handover message from peer');
              this.signaling.resetConnection(saltyrtcClient.CloseCode.ProtocolError);
              break;
            }

            if (this.signaling.handoverState.peer) {
              this.log.warn(this.logTag, 'Handover already received');
              break;
            }

            this.signaling.handoverState.peer = true;

            if (this.transport !== null) {
              this.transport.flushMessageQueue();
            }

            if (this.signaling.handoverState.both) {
              this.log.info(this.logTag, 'Handover to data channel finished');
            }

            break;

          default:
            this.log.error(this.logTag, 'Received message with unknown type:', message.type);
        }
      }
    }, {
      key: "validateOffer",
      value: function validateOffer(message) {
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
    }, {
      key: "validateAnswer",
      value: function validateAnswer(message) {
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
    }, {
      key: "validateCandidates",
      value: function validateCandidates(message) {
        if (message['candidates'] === undefined) {
          this.log.warn(this.logTag, 'Candidates message does not contain candidates');
          return false;
        }

        if (message['candidates'].length < 1) {
          this.log.warn(this.logTag, 'Candidates message contains empty candidate list');
          return false;
        }

        var _iteratorNormalCompletion2 = true;
        var _didIteratorError2 = false;
        var _iteratorError2 = undefined;

        try {
          for (var _iterator2 = message['candidates'][Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
            var candidate = _step2.value;

            if (candidate !== null) {
              if (typeof candidate['candidate'] !== 'string' && !(candidate['candidate'] instanceof String)) {
                this.log.warn(this.logTag, 'Candidates message contains invalid candidate (candidate field)');
                return false;
              }

              if (typeof candidate['sdpMid'] !== 'string' && !(candidate['sdpMid'] instanceof String) && candidate['sdpMid'] !== null) {
                this.log.warn(this.logTag, 'Candidates message contains invalid candidate (sdpMid field)');
                return false;
              }

              if (candidate['sdpMLineIndex'] !== null && !Number.isInteger(candidate['sdpMLineIndex'])) {
                this.log.warn(this.logTag, 'Candidates message contains invalid candidate (sdpMLineIndex field)');
                return false;
              }
            }
          }
        } catch (err) {
          _didIteratorError2 = true;
          _iteratorError2 = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion2 && _iterator2.return != null) {
              _iterator2.return();
            }
          } finally {
            if (_didIteratorError2) {
              throw _iteratorError2;
            }
          }
        }

        return true;
      }
    }, {
      key: "sendSignalingMessage",
      value: function sendSignalingMessage(payload) {
        if (this.signaling.getState() != 'task') {
          throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError, "Could not send signaling message: Signaling state is not 'task'.");
        }

        if (!this.signaling.handoverState.local) {
          throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError, "Could not send signaling message: Handover hasn't happened yet.");
        }

        if (this.transport === null) {
          throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError, 'Could not send signaling message: Data channel is not established, yet.');
        }

        this.transport.send(payload);
      }
    }, {
      key: "getName",
      value: function getName() {
        return "".concat(this.version, ".webrtc.tasks.saltyrtc.org");
      }
    }, {
      key: "getSupportedMessageTypes",
      value: function getSupportedMessageTypes() {
        return ['offer', 'answer', 'candidates', 'handover'];
      }
    }, {
      key: "getData",
      value: function getData() {
        var data = {};
        data[WebRTCTask.FIELD_EXCLUDE] = Array.from(this.exclude.values());
        data[WebRTCTask.FIELD_HANDOVER] = this.doHandover;

        if (this.version === 'v0') {
          data[WebRTCTask.FIELD_MAX_PACKET_SIZE] = this.maxChunkLength;
        }

        return data;
      }
    }, {
      key: "sendOffer",
      value: function sendOffer(offer) {
        this.log.debug(this.logTag, 'Sending offer');

        try {
          this.signaling.sendTaskMessage({
            'type': 'offer',
            'offer': {
              'type': offer.type,
              'sdp': offer.sdp
            }
          });
        } catch (e) {
          if (e.name === 'SignalingError') {
            this.log.error(this.logTag, 'Could not send offer:', e.message);
            this.signaling.resetConnection(e.closeCode);
          }
        }
      }
    }, {
      key: "sendAnswer",
      value: function sendAnswer(answer) {
        this.log.debug(this.logTag, 'Sending answer');

        try {
          this.signaling.sendTaskMessage({
            'type': 'answer',
            'answer': {
              'type': answer.type,
              'sdp': answer.sdp
            }
          });
        } catch (e) {
          if (e.name === 'SignalingError') {
            this.log.error(this.logTag, 'Could not send answer:', e.message);
            this.signaling.resetConnection(e.closeCode);
          }
        }
      }
    }, {
      key: "sendCandidate",
      value: function sendCandidate(candidate) {
        this.sendCandidates([candidate]);
      }
    }, {
      key: "sendCandidates",
      value: function sendCandidates(candidates) {
        var _this$candidates,
            _this = this;

        this.log.debug(this.logTag, 'Buffering', candidates.length, 'candidate(s)');

        (_this$candidates = this.candidates).push.apply(_this$candidates, _toConsumableArray(candidates));

        var sendFunc = function sendFunc() {
          try {
            _this.log.debug(_this.logTag, 'Sending', _this.candidates.length, 'candidate(s)');

            _this.signaling.sendTaskMessage({
              'type': 'candidates',
              'candidates': _this.candidates
            });
          } catch (e) {
            if (e.name === 'SignalingError') {
              _this.log.error(_this.logTag, 'Could not send candidates:', e.message);

              _this.signaling.resetConnection(e.closeCode);
            }
          } finally {
            _this.candidates = [];
            _this.sendCandidatesTimeout = null;
          }
        };

        if (this.sendCandidatesTimeout === null) {
          this.sendCandidatesTimeout = self.setTimeout(sendFunc, WebRTCTask.CANDIDATE_BUFFERING_MS);
        }
      }
    }, {
      key: "getTransportLink",
      value: function getTransportLink() {
        this.log.debug(this.logTag, 'Create signalling transport link');

        if (!this.doHandover) {
          throw new Error('Handover has not been negotiated');
        }

        if (this.channelId === undefined) {
          var error = 'Data channel id not set';
          throw new Error(error);
        }

        if (this.link === null) {
          this.link = new SignalingTransportLink(this.channelId, this.getName());
        }

        return this.link;
      }
    }, {
      key: "handover",
      value: function handover(handler) {
        this.log.debug(this.logTag, 'Initiate handover');

        if (!this.doHandover) {
          throw new Error('Handover has not been negotiated');
        }

        if (this.signaling.handoverState.local || this.transport !== null) {
          throw new Error('Handover already requested');
        }

        var crypto = this.createCryptoContext(this.channelId);
        this.transport = new SignalingTransport(this.link, handler, this, this.signaling, crypto, this.log.level, this.maxChunkLength);
        this.sendHandover();
      }
    }, {
      key: "sendHandover",
      value: function sendHandover() {
        this.log.debug(this.logTag, 'Sending handover');

        try {
          this.signaling.sendTaskMessage({
            'type': 'handover'
          });
        } catch (e) {
          if (e.name === 'SignalingError') {
            this.log.error(this.logTag, 'Could not send handover message', e.message);
            this.signaling.resetConnection(e.closeCode);
          }
        }

        this.signaling.handoverState.local = true;

        if (this.signaling.handoverState.both) {
          this.log.info(this.logTag, 'Handover to data channel finished');
        }
      }
    }, {
      key: "createCryptoContext",
      value: function createCryptoContext(channelId) {
        return new DataChannelCryptoContext(channelId, this.signaling);
      }
    }, {
      key: "close",
      value: function close(reason) {
        this.log.debug(this.logTag, 'Closing signaling data channel:', saltyrtcClient.explainCloseCode(reason));

        if (this.transport !== null) {
          this.transport.close();
        }

        this.transport = null;
      }
    }, {
      key: "on",
      value: function on(event, handler) {
        this.eventRegistry.register(event, handler);
      }
    }, {
      key: "once",
      value: function once(event, handler) {
        var _this2 = this;

        var onceHandler = function onceHandler(ev) {
          try {
            handler(ev);
          } catch (e) {
            _this2.off(ev.type, onceHandler);

            throw e;
          }

          _this2.off(ev.type, onceHandler);
        };

        this.eventRegistry.register(event, onceHandler);
      }
    }, {
      key: "off",
      value: function off(event, handler) {
        if (event === undefined) {
          this.eventRegistry.unregisterAll();
        } else {
          this.eventRegistry.unregister(event, handler);
        }
      }
    }, {
      key: "emit",
      value: function emit(event) {
        this.log.debug(this.logTag, 'New event:', event.type);
        var handlers = this.eventRegistry.get(event.type);
        var _iteratorNormalCompletion3 = true;
        var _didIteratorError3 = false;
        var _iteratorError3 = undefined;

        try {
          for (var _iterator3 = handlers[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
            var handler = _step3.value;

            try {
              this.callHandler(handler, event);
            } catch (e) {
              this.log.error(this.logTag, 'Unhandled exception in', event.type, 'handler:', e);
            }
          }
        } catch (err) {
          _didIteratorError3 = true;
          _iteratorError3 = err;
        } finally {
          try {
            if (!_iteratorNormalCompletion3 && _iterator3.return != null) {
              _iterator3.return();
            }
          } finally {
            if (_didIteratorError3) {
              throw _iteratorError3;
            }
          }
        }
      }
    }, {
      key: "callHandler",
      value: function callHandler(handler, event) {
        var response = handler(event);

        if (response === false) {
          this.eventRegistry.unregister(event.type, handler);
        }
      }
    }, {
      key: "signaling",
      set: function set(signaling) {
        this._signaling = signaling;
        this.logTag = '[SaltyRTC.WebRTC.' + signaling.role + ']';
      },
      get: function get() {
        return this._signaling;
      }
    }]);

    return WebRTCTask;
  }();

  WebRTCTask.FIELD_EXCLUDE = 'exclude';
  WebRTCTask.FIELD_HANDOVER = 'handover';
  WebRTCTask.FIELD_MAX_PACKET_SIZE = 'max_packet_size';
  WebRTCTask.CANDIDATE_BUFFERING_MS = 5;

  exports.DataChannelCryptoContext = DataChannelCryptoContext;
  exports.WebRTCTaskBuilder = WebRTCTaskBuilder;

  return exports;

}({}));
