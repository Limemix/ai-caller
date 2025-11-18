const dgram = require('dgram');
const dns = require('dns').promises;
const EventEmitter = require('events');
const SipAuthentication = require('./SIPAuth');
const SipMessageBuilder = require('./SIPMessageBuilder');
const SIPHandler = require('./SIPHandler');
const RTPStream = require('../rtp/RTPStream');
const Logger = require('../utils/Logger');

class SIPClient extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.logger = new Logger();
        this.sipAuth = new SipAuthentication(config);
        this.messageBuilder = new SipMessageBuilder(config);
        this.sipHandler = new SIPHandler();
        this.rtpStream = new RTPStream(config);

        this.sipSocket = null;
        this.isRegistered = false;
        this.activeCalls = new Map();
        this.callCounter = 0;
        this.serverAddress = null;

        this.setupHandlers();
    }

    startKeepAlive() {
        this.logger.info('🫀 Starting SIP keep-alive');

        this.keepAliveInterval = setInterval(() => {
            if (this.activeCalls.size === 0 && this.isRegistered) {
                this.sendOptions();
            }
        }, 20000);
        this.reregisterInterval = setInterval(() => {
            if (this.activeCalls.size === 0) { 
                this.reregister();
            }
        }, 300000);
    }

    startCallKeepAlive(callId) {
        const call = this.activeCalls.get(callId);
        if (!call) return;

        this.logger.info(`🫀 Starting session keep-alive for call ${callId}`);

        call.sessionKeepAliveInterval = setInterval(() => {
            if (call.state === 'connected' && call.toTag && !call.refreshInProgress) {
                this.sendSessionRefresh(callId);
            }
        }, 25000);
    }

    async sendSessionRefresh(callId) {
        const call = this.activeCalls.get(callId);
        if (!call || call.refreshInProgress) return;

        call.refreshInProgress = true;
        this.logger.info(`🔄 Sending session refresh (re-INVITE) for call ${callId}`);

        const branch = this.messageBuilder.generateBranch();
        const sdp = this.messageBuilder.buildSdpOffer(call.rtpPort);

        const refreshCSeq = call.cseq + 1000 + Math.floor(Math.random() * 100);

        const reInviteMsg = `INVITE sip:${call.targetNumber}@${this.config.sip.server} SIP/2.0\r
Via: SIP/2.0/UDP ${this.config.sip.localIp}:${this.config.sip.localPort};branch=${branch};rport\r
Max-Forwards: 70\r
From: <sip:${this.config.sip.username}@${this.config.sip.server}>;tag=${call.fromTag}\r
To: <sip:${call.targetNumber}@${this.config.sip.server}>;tag=${call.toTag}\r
Call-ID: ${callId}\r
CSeq: ${refreshCSeq} INVITE\r
Contact: <sip:${this.config.sip.username}@${this.config.sip.localIp}:${this.config.sip.localPort}>\r
Content-Type: application/sdp\r
User-Agent: ${this.config.sip.userAgent}\r
Content-Length: ${sdp.length}\r
\r
${sdp}`;

        try {
            await this.sendSipMessage(reInviteMsg);

            call.lastRefreshCSeq = refreshCSeq;

            setTimeout(() => {
                call.refreshInProgress = false;
            }, 5000);

        } catch (error) {
            this.logger.error('❌ Error sending session refresh:', error);
            call.refreshInProgress = false;
        }
    }

    async reregister() {
        if (!this.isRegistered) return;

        this.logger.info('🔄 Re-registering with SIP server');
        try {
            const callId = this.generateCallId();
            const fromTag = this.messageBuilder.generateTag();
            const cseq = 1;

            const registerMsg = this.messageBuilder.buildRegister(callId, fromTag, cseq);
            await this.sendSipMessage(registerMsg);
        } catch (error) {
            this.logger.error('❌ Re-registration failed:', error);
        }
    }

    async sendOptions() {
        if (!this.isRegistered) return;

        const callId = this.generateCallId();
        const fromTag = this.messageBuilder.generateTag();
        const cseq = 5000 + Math.floor(Math.random() * 1000);

        const optionsMsg = this.buildOptionsMessage(callId, fromTag, cseq);

        try {
            await this.sendSipMessage(optionsMsg);
            this.logger.debug('🫀 Sent OPTIONS keep-alive');
        } catch (error) {
            this.logger.error('❌ Error sending OPTIONS:', error);
        }
    }

    buildOptionsMessage(callId, fromTag, cseq) {
        const branch = this.messageBuilder.generateBranch();
        return `OPTIONS sip:${this.config.sip.server} SIP/2.0\r
Via: SIP/2.0/UDP ${this.config.sip.localIp}:${this.config.sip.localPort};branch=${branch};rport\r
Max-Forwards: 70\r
From: <sip:${this.config.sip.username}@${this.config.sip.server}>;tag=${fromTag}\r
To: <sip:${this.config.sip.username}@${this.config.sip.server}>\r
Call-ID: ${callId}\r
CSeq: ${cseq} OPTIONS\r
Contact: <sip:${this.config.sip.username}@${this.config.sip.localIp}:${this.config.sip.localPort}>\r
User-Agent: ${this.config.sip.userAgent}\r
Content-Length: 0\r
\r
`;
    }

    setupHandlers() {
        this.sipHandler.on('call_connected', (callId, remoteRtpInfo) => {
            this.logger.info(`📞 Call ${callId} connected, starting audio`);
            const call = this.activeCalls.get(callId);
            if (call && call.state !== 'ended') {
                this.startAudioPlayback(callId, remoteRtpInfo);
            }
        });

        this.sipHandler.on('call_ended', (callId) => {
            this.logger.info(`📞 Call ${callId} ended by remote party`);
            this.cleanupCall(callId);
            this.emit('call_ended', callId);
        });

        this.sipHandler.on('call_failed', (callId, reason) => {
            this.logger.info(`❌ Call ${callId} failed: ${reason}`);
            this.cleanupCall(callId);
            this.emit('call_failed', callId, reason);
        });

        this.sipHandler.on('auth_required', (callId, authParams) => {
            this.handleAuthRequired(callId, authParams);
        });

        this.sipHandler.on('sip_info', (callId, message) => {
            this.logger.debug('📨 Processing SIP INFO for call:', callId);
            this.sendInfoResponse(callId, message);
        });
    }

    async sendInfoResponse(callId, originalMessage) {
        const call = this.activeCalls.get(callId);
        if (!call) return;

        const lines = originalMessage.split('\r\n');
        let cseq = null;
        for (const line of lines) {
            if (line.startsWith('CSeq:')) {
                cseq = line.split(':')[1].trim();
                break;
            }
        }

        if (!cseq) return;

        const response = `SIP/2.0 200 OK\r
Via: SIP/2.0/UDP ${this.config.sip.server}\r
From: <sip:${this.config.sip.username}@${this.config.sip.server}>;tag=${call.fromTag}\r
To: <sip:${call.targetNumber}@${this.config.sip.server}>;tag=${call.toTag}\r
Call-ID: ${callId}\r
CSeq: ${cseq}\r
User-Agent: ${this.config.sip.userAgent}\r
Content-Length: 0\r
\r
`;

        try {
            await this.sendSipMessage(response);
            this.logger.debug('✅ Sent 200 OK for INFO');
        } catch (error) {
            this.logger.error('❌ Error sending INFO response:', error);
        }
    }

    async connect() {
        return new Promise((resolve, reject) => {
            try {
                this.sipSocket = dgram.createSocket('udp4');

                this.sipSocket.on('message', (msg, rinfo) => {
                    const message = msg.toString();
                    this.handleSipMessage(message, rinfo);
                });

                this.sipSocket.on('error', (err) => {
                    this.logger.error('SIP socket error:', err);
                    reject(err);
                });

                this.sipSocket.on('listening', async () => {
                    this.logger.info(`✅ SIP client listening on ${this.config.sip.localIp}:${this.config.sip.localPort}`);
                    try {
                        await this.resolveServerAddress();
                        await this.register();
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });

                this.sipSocket.bind(this.config.sip.localPort, this.config.sip.localIp);
            } catch (error) {
                reject(error);
            }
        });
    }

    async resolveServerAddress() {
        try {
            const addresses = await dns.resolve4(this.config.sip.server);
            if (addresses.length > 0) {
                this.serverAddress = addresses[0];
                this.logger.info(`✅ Resolved ${this.config.sip.server} to ${this.serverAddress}`);
            } else {
                throw new Error(`Could not resolve ${this.config.sip.server}`);
            }
        } catch (error) {
            this.logger.error(`❌ DNS resolution failed for ${this.config.sip.server}:`, error);
            throw error;
        }
    }

    async register() {
        return new Promise((resolve, reject) => {
            this.registerResolve = resolve;
            this.registerReject = reject;

            const callId = this.generateCallId();
            const fromTag = this.messageBuilder.generateTag();
            const cseq = 1;

            const registerMsg = this.messageBuilder.buildRegister(callId, fromTag, cseq);
            this.sendSipMessage(registerMsg);

            setTimeout(() => {
                if (!this.isRegistered) {
                    reject(new Error('Registration timeout'));
                }
            }, 10000);
        });
    }

    async call(phoneNumber) {
        if (!this.isRegistered) {
            throw new Error('Not registered with SIP server');
        }

        const callId = this.generateCallId();
        const fromTag = this.messageBuilder.generateTag();
        const cseq = 1000 + this.callCounter++;
        const rtpPort = await this.rtpStream.createRtpSocket();

        const callInfo = {
            callId,
            fromTag,
            cseq,
            targetNumber: phoneNumber,
            rtpPort,
            state: 'init',
            toTag: null,
            remoteRtpInfo: null,
            audioPlaying: false,
            stopAudio: null,
            ackSent: false
        };

        this.activeCalls.set(callId, callInfo);

        const inviteMsg = this.messageBuilder.buildOutgoingInvite(
            callId, fromTag, cseq, phoneNumber, rtpPort
        );

        await this.sendSipMessage(inviteMsg);
        this.logger.info(`📞 Making call to ${phoneNumber}, callId: ${callId}`);

        return callId;
    }

    handleSipMessage(message, rinfo) {
        const lines = message.split('\r\n');
        const statusLine = lines[0];

        this.logger.debug('📨 Received SIP message:', statusLine);

        this.sipHandler.handleMessage(message, rinfo);

        let callId = null;
        for (const line of lines) {
            if (line.startsWith('Call-ID:')) {
                callId = line.split(':')[1].trim();
                break;
            }
        }

        if (statusLine.includes('SIP/2.0 200') && !message.includes('REGISTER') && callId) {
            if (!this.activeCalls.has(callId)) {
                this.logger.warn(`⚠️ Ignoring 200 OK for unknown call ${callId}`);
                return;
            }
            this.handleCallConnected(message, callId);
        }

        if (statusLine.includes('SIP/2.0 401') || statusLine.includes('SIP/2.0 407')) {
            this.handleAuthChallenge(message, callId);
        } else if (statusLine.includes('SIP/2.0 200') && message.includes('REGISTER')) {
            this.handleRegisterSuccess();
        } else if (statusLine.includes('SIP/2.0 200') && !message.includes('REGISTER') && callId) {
            this.handleCallConnected(message, callId);
        } else if (statusLine.includes('SIP/2.0 180') || statusLine.includes('SIP/2.0 183')) {
            this.logger.info(`📞 Call ${callId} ringing...`);
        } else if (statusLine.includes('SIP/2.0 486') || statusLine.includes('SIP/2.0 487') || statusLine.includes('SIP/2.0 603')) {
            this.logger.info(`❌ Call ${callId} failed or rejected`);
            this.activeCalls.delete(callId);
        }
    }

    handleAuthChallenge(message, callId) {
        const lines = message.split('\r\n');
        const authParams = this.sipAuth.parseAuthChallenge(lines);

        if (authParams) {
            if (message.includes('REGISTER')) {
                const authHeader = this.sipAuth.generateAuthHeader();
                const newCallId = this.generateCallId();
                const fromTag = this.messageBuilder.generateTag();
                const authRegisterMsg = this.messageBuilder.buildAuthenticatedRegister(
                    newCallId, fromTag, 2, authHeader
                );
                this.sendSipMessage(authRegisterMsg);
            } else if (callId) {
                this.emit('auth_required', callId, authParams);
            }
        }
    }

    handleAuthRequired(callId, authParams) {
        const call = this.activeCalls.get(callId);
        if (!call) return;

        const authHeader = this.sipAuth.generateAuthHeaderForInvite(
            call.targetNumber, call.cseq, authParams
        );

        const authInviteMsg = this.messageBuilder.buildAuthenticatedInvite(
            call.callId, call.fromTag, call.cseq, call.targetNumber, call.rtpPort, authHeader
        );

        this.sendSipMessage(authInviteMsg);
        this.logger.info(`🔐 Sent authenticated INVITE for call ${callId}`);
    }

    handleRegisterSuccess() {
        this.isRegistered = true;
        this.logger.info('✅ Successfully registered with SIP server');

        this.startKeepAlive();

        if (this.registerResolve) {
            this.registerResolve();
        }
    }

    handleCallConnected(message, callId) {
        const call = this.activeCalls.get(callId);

        if (!call) {
            this.logger.warn(`⚠️ Received 200 OK for unknown call ${callId}`);
            return;
        }

        if (call.ackSent) {
            this.logger.debug(`🔄 Ignoring duplicate 200 OK for call ${callId}`);
            return;
        }

        const lines = message.split('\r\n');
        for (const line of lines) {
            if (line.startsWith('To:') && line.includes('tag=')) {
                const tagMatch = line.match(/tag=([^;]+)/);
                if (tagMatch) {
                    call.toTag = tagMatch[1];
                }
            }
        }

        if (!call.ackSent) {
            const ackMsg = this.messageBuilder.buildAck(
                callId, call.fromTag, call.toTag, call.cseq, call.targetNumber
            );
            this.sendSipMessage(ackMsg);
            call.ackSent = true;
            call.state = 'connected';

            this.startCallKeepAlive(callId);

            this.logger.info(`✅ Call ${callId} connected, sending ACK`);
        }

        const remoteRtpInfo = this.parseRemoteRtpInfo(message);
        this.emit('call_connected', callId, remoteRtpInfo);
    }

    parseRemoteRtpInfo(message) {
        const lines = message.split('\r\n');
        let rtpPort = null;
        let remoteIp = null;

        this.logger.debug('🔍 Parsing SDP for RTP info in SIPClient...');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.startsWith('c=IN IP4')) {
                remoteIp = line.split(' ')[2];
                this.logger.debug(`📍 Found remote IP: ${remoteIp}`);
            }

            if (line.startsWith('m=audio')) {
                const parts = line.split(' ');
                if (parts.length > 1) {
                    rtpPort = parseInt(parts[1]);
                    this.logger.debug(`🎵 Found audio RTP port: ${rtpPort}`);

                    for (let j = i + 1; j < lines.length; j++) {
                        const nextLine = lines[j];
                        if (nextLine.startsWith('m=')) {
                            break;
                        }
                        if (nextLine.startsWith('c=IN IP4') && !remoteIp) {
                            remoteIp = nextLine.split(' ')[2];
                            this.logger.debug(`📍 Found media-specific IP: ${remoteIp}`);
                        }
                    }
                }
                break;
            }
        }

        if (!remoteIp || !rtpPort) {
            this.logger.warn('⚠️ Could not parse RTP information from SDP in SIPClient');
        } else {
            this.logger.info(`🎯 RTP destination from SIPClient: ${remoteIp}:${rtpPort}`);
        }

        return { remoteIp, rtpPort };
    }

    async startAudioPlayback(callId, remoteRtpInfo) {
        const call = this.activeCalls.get(callId);
        if (!call) {
            this.logger.error(`❌ Call ${callId} not found for audio playback`);
            return;
        }

        if (!remoteRtpInfo || !remoteRtpInfo.remoteIp || !remoteRtpInfo.rtpPort) {
            this.logger.error(`❌ Invalid RTP info for call ${callId}:`, remoteRtpInfo);
            return;
        }

        this.logger.info(`🔊 Starting continuous tone for call ${callId} to ${remoteRtpInfo.remoteIp}:${remoteRtpInfo.rtpPort}`);

        if (call.stopAudio) {
            call.stopAudio();
        }

        // Просто шум
        call.stopAudio = this.rtpStream.startContinuousTone(
            call.rtpPort,
            remoteRtpInfo.remoteIp,
            remoteRtpInfo.rtpPort,
            440 
        );

        call.audioPlaying = true;
    }

    cleanupCall(callId) {
        const call = this.activeCalls.get(callId);
        if (!call) return;

        if (call.stopAudio) {
            call.stopAudio();
            call.audioPlaying = false;
        }

        call.state = 'ended';

        setTimeout(() => {
            if (this.activeCalls.get(callId)?.state === 'ended') {
                this.activeCalls.delete(callId);
                this.logger.info(`🧹 Cleaned up call ${callId}`);
            }
        }, 2000);
    }

    hangup(callId) {
        const call = this.activeCalls.get(callId);
        if (!call) return;

        this.logger.info(`📞 Hangup call ${callId}`);

        if (call.state === 'connected' && call.toTag) {
            const byeMsg = this.buildByeMessage(call);
            this.sendSipMessage(byeMsg);
        }

        this.cleanupCall(callId);
    }

    async sendSipMessage(message) {
        if (!this.serverAddress) {
            throw new Error('Server address not resolved');
        }

        return new Promise((resolve, reject) => {
            const buffer = Buffer.from(message);

            this.sipSocket.send(buffer, 0, buffer.length,
                this.config.sip.port, this.serverAddress, (err) => {
                    if (err) {
                        this.logger.error('Error sending SIP message:', err);
                        reject(err);
                    } else {
                        this.logger.debug(`📤 Sent SIP message to ${this.serverAddress}:${this.config.sip.port}`);
                        resolve();
                    }
                });
        });
    }

    generateCallId() {
        return Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15) +
            '@' + this.config.sip.localIp;
    }

    buildByeMessage(call) {
        const branch = this.messageBuilder.generateBranch();
        return `BYE sip:${call.targetNumber}@${this.config.sip.server} SIP/2.0\r
Via: SIP/2.0/UDP ${this.config.sip.localIp}:${this.config.sip.localPort};branch=${branch};rport\r
Max-Forwards: 70\r
From: <sip:${this.config.sip.username}@${this.config.sip.server}>;tag=${call.fromTag}\r
To: <sip:${call.targetNumber}@${this.config.sip.server}>;tag=${call.toTag}\r
Call-ID: ${call.callId}\r
CSeq: ${call.cseq + 1} BYE\r
User-Agent: ${this.config.sip.userAgent}\r
Content-Length: 0\r
\r
`;
    }

    destroy() {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
        }
        if (this.reregisterInterval) {
            clearInterval(this.reregisterInterval);
        }
        if (this.sipSocket) {
            this.sipSocket.close();
        }
        this.rtpStream.destroy();
    }
}

module.exports = SIPClient;