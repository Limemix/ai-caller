const EventEmitter = require('events');
const Logger = require('../utils/Logger');

class SIPHandler extends EventEmitter {
    constructor() {
        super();
        this.logger = new Logger(false);
        this.processedCalls = new Set();
    }

    handleMessage(message, rinfo) {
        const lines = message.split('\r\n');
        const statusLine = lines[0];
        const callId = this.extractCallId(lines);

        this.logger.debug('Обработка SIP сообщения:', statusLine);
        // Игнорируем повторные 200 OK для уже обработанных звонков
        if (statusLine.includes('SIP/2.0 200') && !message.includes('REGISTER') && callId) {
            if (this.processedCalls.has(callId)) {
                this.logger.debug(`🔄 Ignoring duplicate 200 OK for call ${callId}`);
                return;
            }
            this.processedCalls.add(callId);
        }

        if (statusLine.startsWith('OPTIONS')) {
            this.handleOptions(message, rinfo);
        } else if (statusLine.includes('SIP/2.0 401')) {
            this.logger.info('🔐 401 Unauthorized');
            this.emit('auth_required', callId, this.parseAuthParams(lines));
        } else if (statusLine.includes('SIP/2.0 407')) {
            this.logger.info('🔐 407 Proxy Authentication Required');
            this.emit('auth_required', callId, this.parseAuthParams(lines));
        } else if (statusLine.includes('SIP/2.0 200') && message.includes('REGISTER')) {
            this.logger.info('✅ Registration successful');
            this.emit('registered');
        } else if (statusLine.includes('SIP/2.0 180')) {
            this.logger.info('📞 180 Ringing');
            this.emit('ringing', callId);
        } else if (statusLine.includes('SIP/2.0 183')) {
            this.logger.info('📞 183 Session Progress');
            this.emit('session_progress', callId);
        } else if (statusLine.includes('SIP/2.0 200') && !message.includes('REGISTER')) {
            this.logger.info('✅ Call connected (200 OK)');
            const remoteRtpInfo = this.parseRemoteRtpInfo(message);
            this.emit('call_connected', callId, remoteRtpInfo);
        } else if (statusLine.includes('SIP/2.0 404')) {
            this.logger.info('❌ 404 Not Found - Call failed');
            this.emit('call_failed', callId, '404 Not Found');
        } else if (statusLine.includes('SIP/2.0 486')) {
            this.logger.info('❌ Абонент занят (486)');
            this.emit('call_ended', callId);
        } else if (statusLine.includes('SIP/2.0 487')) {
            this.logger.info('❌ Call terminated (487)');
            this.emit('call_ended', callId);
        } else if (statusLine.includes('SIP/2.0 603')) {
            this.logger.info('❌ Вызов отклонен (603 Decline)');
            this.emit('call_ended', callId);
        } else if (statusLine.includes('SIP/2.0 100')) {
            this.logger.info('⏳ 100 Trying - сервер обрабатывает запрос');
        } else if (statusLine.startsWith('BYE')) {
            this.logger.info('📞 Получен BYE от удаленной стороны');
            this.emit('call_ended', callId);
        } else if (statusLine.startsWith('INFO')) {
            this.logger.debug('📨 Received SIP INFO message');
            this.emit('sip_info', callId, message);
        } else if (statusLine.startsWith('OPTIONS')) {
            this.handleOptions(message, rinfo);
        } else {
            this.logger.warn('⚠️ Необработанное SIP сообщение:', statusLine);
	        // console.log(message)
        }
    }

    extractCallId(lines) {
        for (const line of lines) {
            if (line.startsWith('Call-ID:')) {
                return line.split(':')[1].trim();
            }
        }
        return null;
    }

    parseAuthParams(lines) {
        let realm = '';
        let nonce = '';
        let qop = '';
        let algorithm = 'MD5';

        for (const line of lines) {
            if (line.startsWith('WWW-Authenticate:') || line.startsWith('Proxy-Authenticate:')) {
                const realmMatch = line.match(/realm="([^"]+)"/);
                if (realmMatch) realm = realmMatch[1];

                const nonceMatch = line.match(/nonce="([^"]+)"/);
                if (nonceMatch) nonce = nonceMatch[1];

                const qopMatch = line.match(/qop="([^"]+)"/);
                if (qopMatch) qop = qopMatch[1];

                const algoMatch = line.match(/algorithm=([^,\s]+)/);
                if (algoMatch) algorithm = algoMatch[1];
            }
        }

        return { realm, nonce, qop, algorithm };
    }

    parseRemoteRtpInfo(message) {
        const lines = message.split('\r\n');
        let rtpPort = null;
        let remoteIp = null;

        this.logger.debug('🔍 Parsing SDP for RTP info...');

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
            this.logger.warn('⚠️ Could not parse RTP information from SDP');
        } else {
            this.logger.info(`🎯 RTP destination: ${remoteIp}:${rtpPort}`);
        }

        return { remoteIp, rtpPort };
    }

    handleOptions(message, rinfo) {
        this.logger.debug('Received OPTIONS request');
    }
}

module.exports = SIPHandler;
