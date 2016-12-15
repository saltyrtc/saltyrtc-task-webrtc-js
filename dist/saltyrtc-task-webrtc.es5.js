/**
 * saltyrtc-task-webrtc v0.5.2
 * A SaltyRTC WebRTC task implementation.
 * https://github.com/saltyrtc/saltyrtc-task-webrtc-js#readme
 *
 * Copyright (C) 2016 Threema GmbH
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

(function (exports) {
'use strict';

var asyncGenerator = function () {
  function AwaitValue(value) {
    this.value = value;
  }

  function AsyncGenerator(gen) {
    var front, back;

    function send(key, arg) {
      return new Promise(function (resolve, reject) {
        var request = {
          key: key,
          arg: arg,
          resolve: resolve,
          reject: reject,
          next: null
        };

        if (back) {
          back = back.next = request;
        } else {
          front = back = request;
          resume(key, arg);
        }
      });
    }

    function resume(key, arg) {
      try {
        var result = gen[key](arg);
        var value = result.value;

        if (value instanceof AwaitValue) {
          Promise.resolve(value.value).then(function (arg) {
            resume("next", arg);
          }, function (arg) {
            resume("throw", arg);
          });
        } else {
          settle(result.done ? "return" : "normal", result.value);
        }
      } catch (err) {
        settle("throw", err);
      }
    }

    function settle(type, value) {
      switch (type) {
        case "return":
          front.resolve({
            value: value,
            done: true
          });
          break;

        case "throw":
          front.reject(value);
          break;

        default:
          front.resolve({
            value: value,
            done: false
          });
          break;
      }

      front = front.next;

      if (front) {
        resume(front.key, front.arg);
      } else {
        back = null;
      }
    }

    this._invoke = send;

    if (typeof gen.return !== "function") {
      this.return = undefined;
    }
  }

  if (typeof Symbol === "function" && Symbol.asyncIterator) {
    AsyncGenerator.prototype[Symbol.asyncIterator] = function () {
      return this;
    };
  }

  AsyncGenerator.prototype.next = function (arg) {
    return this._invoke("next", arg);
  };

  AsyncGenerator.prototype.throw = function (arg) {
    return this._invoke("throw", arg);
  };

  AsyncGenerator.prototype.return = function (arg) {
    return this._invoke("return", arg);
  };

  return {
    wrap: function (fn) {
      return function () {
        return new AsyncGenerator(fn.apply(this, arguments));
      };
    },
    await: function (value) {
      return new AwaitValue(value);
    }
  };
}();





var classCallCheck = function (instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
};

var createClass = function () {
  function defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, descriptor.key, descriptor);
    }
  }

  return function (Constructor, protoProps, staticProps) {
    if (protoProps) defineProperties(Constructor.prototype, protoProps);
    if (staticProps) defineProperties(Constructor, staticProps);
    return Constructor;
  };
}();







var get$1 = function get$1(object, property, receiver) {
  if (object === null) object = Function.prototype;
  var desc = Object.getOwnPropertyDescriptor(object, property);

  if (desc === undefined) {
    var parent = Object.getPrototypeOf(object);

    if (parent === null) {
      return undefined;
    } else {
      return get$1(parent, property, receiver);
    }
  } else if ("value" in desc) {
    return desc.value;
  } else {
    var getter = desc.get;

    if (getter === undefined) {
      return undefined;
    }

    return getter.call(receiver);
  }
};

















var set$1 = function set$1(object, property, value, receiver) {
  var desc = Object.getOwnPropertyDescriptor(object, property);

  if (desc === undefined) {
    var parent = Object.getPrototypeOf(object);

    if (parent !== null) {
      set$1(parent, property, value, receiver);
    }
  } else if ("value" in desc && desc.writable) {
    desc.value = value;
  } else {
    var setter = desc.set;

    if (setter !== undefined) {
      setter.call(receiver, value);
    }
  }

  return value;
};















var toConsumableArray = function (arr) {
  if (Array.isArray(arr)) {
    for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i];

    return arr2;
  } else {
    return Array.from(arr);
  }
};

var DataChannelNonce = function () {
    function DataChannelNonce(cookie, channelId, overflow, sequenceNumber) {
        classCallCheck(this, DataChannelNonce);

        this._cookie = cookie;
        this._overflow = overflow;
        this._sequenceNumber = sequenceNumber;
        this._channelId = channelId;
    }

    createClass(DataChannelNonce, [{
        key: 'toArrayBuffer',
        value: function toArrayBuffer() {
            var buf = new ArrayBuffer(DataChannelNonce.TOTAL_LENGTH);
            var uint8view = new Uint8Array(buf);
            uint8view.set(this._cookie.bytes);
            var view = new DataView(buf);
            view.setUint16(16, this._channelId);
            view.setUint16(18, this._overflow);
            view.setUint32(20, this._sequenceNumber);
            return buf;
        }
    }, {
        key: 'toUint8Array',
        value: function toUint8Array() {
            return new Uint8Array(this.toArrayBuffer());
        }
    }, {
        key: 'cookie',
        get: function get() {
            return this._cookie;
        }
    }, {
        key: 'overflow',
        get: function get() {
            return this._overflow;
        }
    }, {
        key: 'sequenceNumber',
        get: function get() {
            return this._sequenceNumber;
        }
    }, {
        key: 'combinedSequenceNumber',
        get: function get() {
            return (this._overflow << 32) + this._sequenceNumber;
        }
    }, {
        key: 'channelId',
        get: function get() {
            return this._channelId;
        }
    }], [{
        key: 'fromArrayBuffer',
        value: function fromArrayBuffer(packet) {
            if (packet.byteLength != DataChannelNonce.TOTAL_LENGTH) {
                throw 'bad-packet-length';
            }
            var view = new DataView(packet);
            var cookie = new saltyrtcClient.Cookie(new Uint8Array(packet, 0, 16));
            var channelId = view.getUint16(16);
            var overflow = view.getUint16(18);
            var sequenceNumber = view.getUint32(20);
            return new DataChannelNonce(cookie, channelId, overflow, sequenceNumber);
        }
    }]);
    return DataChannelNonce;
}();

DataChannelNonce.TOTAL_LENGTH = 24;

var SecureDataChannel = function () {
    function SecureDataChannel(dc, task) {
        var _this = this;

        classCallCheck(this, SecureDataChannel);

        this.logTag = 'SecureDataChannel:';
        this.messageNumber = 0;
        this.chunkCount = 0;
        this.onChunk = function (event) {
            console.debug(_this.logTag, 'Received chunk');
            if (event.data instanceof Blob) {
                console.warn(_this.logTag, 'Received message in blob format, which is not currently supported.');
                return;
            } else if (typeof event.data == 'string') {
                console.warn(_this.logTag, 'Received message in string format, which is not currently supported.');
                return;
            } else if (!(event.data instanceof ArrayBuffer)) {
                console.warn(_this.logTag, 'Received message in unsupported format. Please send ArrayBuffer objects.');
                return;
            }
            _this.unchunker.add(event.data, event);
            if (_this.chunkCount++ > SecureDataChannel.CHUNK_COUNT_GC) {
                _this.unchunker.gc(SecureDataChannel.CHUNK_MAX_AGE);
                _this.chunkCount = 0;
            }
        };
        this.onEncryptedMessage = function (data, context) {
            if (_this._onmessage === undefined) {
                return;
            }
            console.debug(_this.logTag, 'Decrypting incoming data...');
            var realEvent = context[context.length - 1];
            var fakeEvent = {};
            for (var x in realEvent) {
                fakeEvent[x] = realEvent[x];
            }
            var box = saltyrtcClient.Box.fromUint8Array(new Uint8Array(data), nacl.box.nonceLength);
            try {
                _this.validateNonce(DataChannelNonce.fromArrayBuffer(box.nonce.buffer));
            } catch (e) {
                console.error(_this.logTag, 'Invalid nonce:', e);
                console.error(_this.logTag, 'Closing data channel');
                _this.close();
                _this.task.close(saltyrtcClient.CloseCode.ProtocolError);
                return;
            }
            var decrypted = _this.task.getSignaling().decryptFromPeer(box);
            fakeEvent['data'] = decrypted.buffer.slice(decrypted.byteOffset, decrypted.byteOffset + decrypted.byteLength);
            _this._onmessage.bind(_this.dc)(fakeEvent);
        };
        if (dc.binaryType !== 'arraybuffer') {
            throw new Error('Currently SaltyRTC can only handle data channels ' + 'with `binaryType` set to `arraybuffer`.');
        }
        this.dc = dc;
        this.task = task;
        this.cookiePair = new saltyrtcClient.CookiePair();
        this.csnPair = new saltyrtcClient.CombinedSequencePair();
        this.chunkSize = this.task.getMaxPacketSize();
        if (this.chunkSize === null) {
            throw new Error('Could not determine max chunk size');
        }
        if (this.chunkSize === 0) {
            this.dc.onmessage = function (event) {
                return _this.onEncryptedMessage(event.data, [event]);
            };
        } else {
            this.unchunker = new chunkedDc.Unchunker();
            this.unchunker.onMessage = this.onEncryptedMessage;
            this.dc.onmessage = this.onChunk;
        }
    }

    createClass(SecureDataChannel, [{
        key: 'send',
        value: function send(data) {
            var buffer = void 0;
            if (typeof data === 'string') {
                throw new Error('SecureDataChannel can only handle binary data.');
            } else if (data instanceof Blob) {
                throw new Error('SecureDataChannel does not currently support Blob data. ' + 'Please pass in an ArrayBuffer or a typed array (e.g. Uint8Array).');
            } else if (data instanceof Int8Array || data instanceof Uint8ClampedArray || data instanceof Int16Array || data instanceof Uint16Array || data instanceof Int32Array || data instanceof Uint32Array || data instanceof Float32Array || data instanceof Float64Array || data instanceof DataView) {
                var start = data.byteOffset || 0;
                var end = start + (data.byteLength || data.buffer.byteLength);
                buffer = data.buffer.slice(start, end);
            } else if (data instanceof Uint8Array) {
                buffer = data.buffer;
            } else if (data instanceof ArrayBuffer) {
                buffer = data;
            } else {
                throw new Error('Unknown data type. Please pass in an ArrayBuffer ' + 'or a typed array (e.g. Uint8Array).');
            }
            var box = this.encryptData(new Uint8Array(buffer));
            var encryptedBytes = box.toUint8Array();
            if (this.chunkSize === 0) {
                this.dc.send(encryptedBytes);
            } else {
                var chunker = new chunkedDc.Chunker(this.messageNumber++, encryptedBytes, this.chunkSize);
                var _iteratorNormalCompletion = true;
                var _didIteratorError = false;
                var _iteratorError = undefined;

                try {
                    for (var _iterator = chunker[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                        var chunk = _step.value;

                        this.dc.send(chunk);
                    }
                } catch (err) {
                    _didIteratorError = true;
                    _iteratorError = err;
                } finally {
                    try {
                        if (!_iteratorNormalCompletion && _iterator.return) {
                            _iterator.return();
                        }
                    } finally {
                        if (_didIteratorError) {
                            throw _iteratorError;
                        }
                    }
                }
            }
        }
    }, {
        key: 'encryptData',
        value: function encryptData(data) {
            var csn = this.csnPair.ours.next();
            var nonce = new DataChannelNonce(this.cookiePair.ours, this.dc.id, csn.overflow, csn.sequenceNumber);
            var encrypted = this.task.getSignaling().encryptForPeer(data, nonce.toUint8Array());
            return encrypted;
        }
    }, {
        key: 'validateNonce',
        value: function validateNonce(nonce) {
            if (nonce.cookie.equals(this.cookiePair.ours)) {
                throw new Error('Local and remote cookie are equal');
            }
            if (this.cookiePair.theirs === null || this.cookiePair.theirs === undefined) {
                this.cookiePair.theirs = nonce.cookie;
            } else if (!nonce.cookie.equals(this.cookiePair.theirs)) {
                throw new Error("Remote cookie changed");
            }
            if (this.lastIncomingCsn != null && nonce.combinedSequenceNumber == this.lastIncomingCsn) {
                throw new Error("CSN reuse detected!");
            }
            if (nonce.channelId != this.dc.id) {
                throw new Error("Data channel id in nonce does not match actual data channel id");
            }
            this.lastIncomingCsn = nonce.combinedSequenceNumber;
        }
    }, {
        key: 'close',
        value: function close() {
            this.dc.close();
        }
    }, {
        key: 'addEventListener',
        value: function addEventListener(type, listener, useCapture) {
            if (type === 'message') {
                throw new Error('addEventListener on message events is not currently supported by SaltyRTC.');
            } else {
                this.dc.addEventListener(type, listener, useCapture);
            }
        }
    }, {
        key: 'removeEventListener',
        value: function removeEventListener(type, listener, useCapture) {
            if (type === 'message') {
                throw new Error('removeEventListener on message events is not currently supported by SaltyRTC.');
            } else {
                this.dc.removeEventListener(type, listener, useCapture);
            }
        }
    }, {
        key: 'dispatchEvent',
        value: function dispatchEvent(e) {
            return this.dc.dispatchEvent(e);
        }
    }, {
        key: 'label',
        get: function get() {
            return this.dc.label;
        }
    }, {
        key: 'ordered',
        get: function get() {
            return this.dc.ordered;
        }
    }, {
        key: 'maxPacketLifeTime',
        get: function get() {
            return this.dc.maxPacketLifeTime;
        }
    }, {
        key: 'maxRetransmits',
        get: function get() {
            return this.dc.maxRetransmits;
        }
    }, {
        key: 'protocol',
        get: function get() {
            return this.dc.protocol;
        }
    }, {
        key: 'negotiated',
        get: function get() {
            return this.dc.negotiated;
        }
    }, {
        key: 'id',
        get: function get() {
            return this.dc.id;
        }
    }, {
        key: 'readyState',
        get: function get() {
            return this.dc.readyState;
        }
    }, {
        key: 'bufferedAmount',
        get: function get() {
            return this.dc.bufferedAmount;
        }
    }, {
        key: 'bufferedAmountLowThreshold',
        get: function get() {
            return this.dc.bufferedAmountLowThreshold;
        },
        set: function set(value) {
            this.dc.bufferedAmountLowThreshold = value;
        }
    }, {
        key: 'binaryType',
        get: function get() {
            return this.dc.binaryType;
        },
        set: function set(value) {
            this.dc.binaryType = value;
        }
    }, {
        key: 'onopen',
        get: function get() {
            return this.dc.onopen;
        },
        set: function set(value) {
            this.dc.onopen = value;
        }
    }, {
        key: 'onbufferedamountlow',
        get: function get() {
            return this.dc.onbufferedamountlow;
        },
        set: function set(value) {
            this.dc.onbufferedamountlow = value;
        }
    }, {
        key: 'onerror',
        get: function get() {
            return this.dc.onerror;
        },
        set: function set(value) {
            this.dc.onerror = value;
        }
    }, {
        key: 'onclose',
        get: function get() {
            return this.dc.onclose;
        },
        set: function set(value) {
            this.dc.onclose = value;
        }
    }, {
        key: 'onmessage',
        get: function get() {
            return this.dc.onmessage;
        },
        set: function set(value) {
            this._onmessage = value;
        }
    }]);
    return SecureDataChannel;
}();

SecureDataChannel.CHUNK_COUNT_GC = 32;
SecureDataChannel.CHUNK_MAX_AGE = 60000;

var WebRTCTask = function () {
    function WebRTCTask() {
        var handover = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;
        var maxPacketSize = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : WebRTCTask.DEFAULT_MAX_PACKET_SIZE;
        classCallCheck(this, WebRTCTask);

        this.initialized = false;
        this.exclude = new Set();
        this.doHandover = true;
        this.sdc = null;
        this.eventRegistry = new saltyrtcClient.EventRegistry();
        this.candidates = [];
        this.sendCandidatesTimeout = null;
        this.doHandover = handover;
        this.requestedMaxPacketSize = maxPacketSize;
    }

    createClass(WebRTCTask, [{
        key: 'init',
        value: function init(signaling, data) {
            this.processExcludeList(data[WebRTCTask.FIELD_EXCLUDE]);
            this.processMaxPacketSize(data[WebRTCTask.FIELD_MAX_PACKET_SIZE]);
            this.processHandover(data[WebRTCTask.FIELD_HANDOVER]);
            this.signaling = signaling;
            this.initialized = true;
        }
    }, {
        key: 'processExcludeList',
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
                    if (!_iteratorNormalCompletion && _iterator.return) {
                        _iterator.return();
                    }
                } finally {
                    if (_didIteratorError) {
                        throw _iteratorError;
                    }
                }
            }

            for (var i = 0; i <= 65535; i++) {
                if (!this.exclude.has(i)) {
                    this.sdcId = i;
                    break;
                }
            }
            if (this.sdcId === undefined && this.doHandover === true) {
                throw new Error('Exclude list is too big, no free data channel id can be found');
            }
        }
    }, {
        key: 'processMaxPacketSize',
        value: function processMaxPacketSize(maxPacketSize) {
            if (!Number.isInteger(maxPacketSize)) {
                throw new RangeError(WebRTCTask.FIELD_MAX_PACKET_SIZE + ' field must be an integer');
            }
            if (maxPacketSize < 0) {
                throw new RangeError(WebRTCTask.FIELD_MAX_PACKET_SIZE + ' field must be positive');
            }
            if (maxPacketSize === 0 && this.requestedMaxPacketSize === 0) {
                this.negotiatedMaxPacketSize = 0;
            } else if (maxPacketSize === 0 || this.requestedMaxPacketSize === 0) {
                this.negotiatedMaxPacketSize = Math.max(maxPacketSize, this.requestedMaxPacketSize);
            } else {
                this.negotiatedMaxPacketSize = Math.min(maxPacketSize, this.requestedMaxPacketSize);
            }
            console.debug(this.logTag, 'Max packet size: We requested', this.requestedMaxPacketSize, 'bytes, peer requested', maxPacketSize, 'bytes. Using', this.negotiatedMaxPacketSize + '.');
        }
    }, {
        key: 'processHandover',
        value: function processHandover(handover) {
            if (handover === false) {
                this.doHandover = false;
            }
        }
    }, {
        key: 'onPeerHandshakeDone',
        value: function onPeerHandshakeDone() {}
    }, {
        key: 'onTaskMessage',
        value: function onTaskMessage(message) {
            console.debug('New task message arrived: ' + message.type);
            switch (message.type) {
                case 'offer':
                    if (this.validateOffer(message) !== true) return;
                    this.emit({ type: 'offer', data: message['offer'] });
                    break;
                case 'answer':
                    if (this.validateAnswer(message) !== true) return;
                    this.emit({ type: 'answer', data: message['answer'] });
                    break;
                case 'candidates':
                    if (this.validateCandidates(message) !== true) return;
                    this.emit({ type: 'candidates', data: message['candidates'] });
                    break;
                case 'handover':
                    if (this.doHandover === false) {
                        console.error(this.logTag, 'Received unexpected handover message from peer');
                        this.signaling.resetConnection(saltyrtcClient.CloseCode.ProtocolError);
                        break;
                    }
                    if (this.signaling.handoverState.local === false) {
                        this.sendHandover();
                    }
                    this.signaling.handoverState.peer = true;
                    if (this.signaling.handoverState.both) {
                        console.info('Handover to data channel finished');
                    }
                    break;
                default:
                    console.error('Received message with unknown type:', message.type);
            }
        }
    }, {
        key: 'validateOffer',
        value: function validateOffer(message) {
            if (message['offer'] === undefined) {
                console.warn(this.logTag, 'Offer message does not contain offer');
                return false;
            }
            if (message['offer']['sdp'] === undefined) {
                console.warn(this.logTag, 'Offer message does not contain offer sdp');
                return false;
            }
            return true;
        }
    }, {
        key: 'validateAnswer',
        value: function validateAnswer(message) {
            if (message['answer'] === undefined) {
                console.warn(this.logTag, 'Answer message does not contain answer');
                return false;
            }
            if (message['answer']['sdp'] === undefined) {
                console.warn(this.logTag, 'Answer message does not contain answer sdp');
                return false;
            }
            return true;
        }
    }, {
        key: 'validateCandidates',
        value: function validateCandidates(message) {
            if (message['candidates'] === undefined) {
                console.warn(this.logTag, 'Candidates message does not contain candidates');
                return false;
            }
            if (message['candidates'].length < 1) {
                console.warn(this.logTag, 'Candidates message contains empty candidate list');
                return false;
            }
            var _iteratorNormalCompletion2 = true;
            var _didIteratorError2 = false;
            var _iteratorError2 = undefined;

            try {
                for (var _iterator2 = message['candidates'][Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                    var candidate = _step2.value;

                    if (typeof candidate['candidate'] !== 'string' && !(candidate['candidate'] instanceof String)) {
                        console.warn(this.logTag, 'Candidates message contains invalid candidate (candidate field)');
                        return false;
                    }
                    if (typeof candidate['sdpMid'] !== 'string' && !(candidate['sdpMid'] instanceof String) && candidate['sdpMid'] !== null) {
                        console.warn(this.logTag, 'Candidates message contains invalid candidate (sdpMid field)');
                        return false;
                    }
                    if (candidate['sdpMLineIndex'] !== null && !Number.isInteger(candidate['sdpMLineIndex'])) {
                        console.warn(this.logTag, 'Candidates message contains invalid candidate (sdpMLineIndex field)');
                        return false;
                    }
                }
            } catch (err) {
                _didIteratorError2 = true;
                _iteratorError2 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion2 && _iterator2.return) {
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
        key: 'sendSignalingMessage',
        value: function sendSignalingMessage(payload) {
            if (this.signaling.getState() != 'task') {
                throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError, 'Could not send signaling message: Signaling state is not open.');
            }
            if (this.signaling.handoverState.local === false) {
                throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError, 'Could not send signaling message: Handover hasn\'t happened yet.');
            }
            this.sdc.send(payload);
        }
    }, {
        key: 'getName',
        value: function getName() {
            return WebRTCTask.PROTOCOL_NAME;
        }
    }, {
        key: 'getSupportedMessageTypes',
        value: function getSupportedMessageTypes() {
            return ['offer', 'answer', 'candidates', 'handover'];
        }
    }, {
        key: 'getMaxPacketSize',
        value: function getMaxPacketSize() {
            if (this.initialized === true) {
                return this.negotiatedMaxPacketSize;
            }
            return null;
        }
    }, {
        key: 'getData',
        value: function getData() {
            var data = {};
            data[WebRTCTask.FIELD_EXCLUDE] = Array.from(this.exclude.values());
            data[WebRTCTask.FIELD_MAX_PACKET_SIZE] = this.requestedMaxPacketSize;
            data[WebRTCTask.FIELD_HANDOVER] = this.doHandover;
            return data;
        }
    }, {
        key: 'getSignaling',
        value: function getSignaling() {
            return this.signaling;
        }
    }, {
        key: 'sendOffer',
        value: function sendOffer(offer) {
            console.debug(this.logTag, 'Sending offer');
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
                    console.error(this.logTag, 'Could not send offer:', e.message);
                    this.signaling.resetConnection(e.closeCode);
                }
            }
        }
    }, {
        key: 'sendAnswer',
        value: function sendAnswer(answer) {
            console.debug(this.logTag, 'Sending answer');
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
                    console.error(this.logTag, 'Could not send answer:', e.message);
                    this.signaling.resetConnection(e.closeCode);
                }
            }
        }
    }, {
        key: 'sendCandidate',
        value: function sendCandidate(candidate) {
            this.sendCandidates([candidate]);
        }
    }, {
        key: 'sendCandidates',
        value: function sendCandidates(candidates) {
            var _candidates,
                _this = this;

            console.debug(this.logTag, 'Buffering', candidates.length, 'candidate(s)');
            (_candidates = this.candidates).push.apply(_candidates, toConsumableArray(candidates));
            var sendFunc = function sendFunc() {
                try {
                    console.debug(_this.logTag, 'Sending', _this.candidates.length, 'candidate(s)');
                    _this.signaling.sendTaskMessage({
                        'type': 'candidates',
                        'candidates': _this.candidates
                    });
                } catch (e) {
                    if (e.name === 'SignalingError') {
                        console.error(_this.logTag, 'Could not send candidates:', e.message);
                        _this.signaling.resetConnection(e.closeCode);
                    }
                } finally {
                    _this.candidates = [];
                    _this.sendCandidatesTimeout = null;
                }
            };
            if (this.sendCandidatesTimeout === null) {
                this.sendCandidatesTimeout = window.setTimeout(sendFunc, WebRTCTask.CANDIDATE_BUFFERING_MS);
            }
        }
    }, {
        key: 'handover',
        value: function handover(pc) {
            var _this2 = this;

            console.debug(this.logTag, 'Initiate handover');
            if (this.doHandover === false) {
                console.error(this.logTag, 'Cannot do handover: Either us or our peer set handover=false');
                return false;
            }
            if (this.signaling.handoverState.any) {
                console.error(this.logTag, 'Handover already in progress or finished');
                return false;
            }
            if (this.sdcId === undefined || this.sdcId === null) {
                console.error(this.logTag, 'Data channel id not set');
                this.signaling.resetConnection(saltyrtcClient.CloseCode.InternalError);
                throw new Error('Data channel id not set');
            }
            var dc = pc.createDataChannel(WebRTCTask.DC_LABEL, {
                id: this.sdcId,
                negotiated: true,
                ordered: true,
                protocol: WebRTCTask.PROTOCOL_NAME
            });
            dc.binaryType = 'arraybuffer';
            this.sdc = new SecureDataChannel(dc, this);
            this.sdc.onopen = function (ev) {
                _this2.sendHandover();
            };
            this.sdc.onclose = function (ev) {
                if (_this2.signaling.handoverState.any) {
                    _this2.signaling.setState('closed');
                }
            };
            this.sdc.onerror = function (ev) {
                console.error(_this2.logTag, 'Signaling data channel error:', ev);
            };
            this.sdc.onbufferedamountlow = function (ev) {
                console.warn(_this2.logTag, 'Signaling data channel: Buffered amount low:', ev);
            };
            this.sdc.onmessage = function (ev) {
                var decryptedData = new Uint8Array(ev.data);
                _this2.signaling.onSignalingPeerMessage(decryptedData);
            };
            return true;
        }
    }, {
        key: 'sendHandover',
        value: function sendHandover() {
            console.debug(this.logTag, 'Sending handover');
            try {
                this.signaling.sendTaskMessage({ 'type': 'handover' });
            } catch (e) {
                if (e.name === 'SignalingError') {
                    console.error(this.logTag, 'Could not send handover message', e.message);
                    this.signaling.resetConnection(e.closeCode);
                }
            }
            this.signaling.handoverState.local = true;
            if (this.signaling.handoverState.both) {
                console.info(this.logTag, 'Handover to data channel finished');
            }
        }
    }, {
        key: 'wrapDataChannel',
        value: function wrapDataChannel(dc) {
            console.debug(this.logTag, "Wrapping data channel", dc.id);
            return new SecureDataChannel(dc, this);
        }
    }, {
        key: 'close',
        value: function close(reason) {
            console.debug('Closing signaling data channel:', saltyrtcClient.explainCloseCode(reason));
            if (this.sdc !== null) {
                this.sdc.close();
            }
            this.sdc = null;
        }
    }, {
        key: 'on',
        value: function on(event, handler) {
            this.eventRegistry.register(event, handler);
        }
    }, {
        key: 'once',
        value: function once(event, handler) {
            var _this3 = this;

            var onceHandler = function onceHandler(ev) {
                try {
                    handler(ev);
                } catch (e) {
                    _this3.off(ev.type, onceHandler);
                    throw e;
                }
                _this3.off(ev.type, onceHandler);
            };
            this.eventRegistry.register(event, onceHandler);
        }
    }, {
        key: 'off',
        value: function off(event, handler) {
            this.eventRegistry.unregister(event, handler);
        }
    }, {
        key: 'emit',
        value: function emit(event) {
            console.debug(this.logTag, 'New event:', event.type);
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
                        console.error('SaltyRTC: Unhandled exception in', event.type, 'handler:', e);
                    }
                }
            } catch (err) {
                _didIteratorError3 = true;
                _iteratorError3 = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion3 && _iterator3.return) {
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
        key: 'callHandler',
        value: function callHandler(handler, event) {
            var response = handler(event);
            if (response === false) {
                this.eventRegistry.unregister(event.type, handler);
            }
        }
    }, {
        key: 'logTag',
        get: function get() {
            if (this.signaling === null || this.signaling === undefined) {
                return 'SaltyRTC.WebRTC:';
            }
            return 'SaltyRTC.WebRTC.' + this.signaling.role + ':';
        }
    }]);
    return WebRTCTask;
}();

WebRTCTask.PROTOCOL_NAME = 'v0.webrtc.tasks.saltyrtc.org';
WebRTCTask.DEFAULT_MAX_PACKET_SIZE = 16384;
WebRTCTask.FIELD_EXCLUDE = 'exclude';
WebRTCTask.FIELD_MAX_PACKET_SIZE = 'max_packet_size';
WebRTCTask.FIELD_HANDOVER = 'handover';
WebRTCTask.DC_LABEL = 'saltyrtc-signaling';
WebRTCTask.CANDIDATE_BUFFERING_MS = 5;

exports.WebRTCTask = WebRTCTask;

}((this.saltyrtcTaskWebrtc = this.saltyrtcTaskWebrtc || {})));
