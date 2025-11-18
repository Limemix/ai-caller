const SIPClient = require('./src/sip/SIPClient');
const config = require('./src/config');

async function main() {
    const client = new SIPClient(config);
    
    try {
        await client.connect();
        console.log('Подключено к SIP серверу!');
        
        const phoneNumber = process.argv[2] || '380970793024';
        const callId = await client.call(phoneNumber);
        console.log(`📞 Calling ${phoneNumber}, callId: ${callId}`);
        
        client.on('call_ended', (endedCallId) => {
            if (endedCallId === callId) {
                console.log('Звонок окончен');
                process.exit(0);
            }
        });

        client.on('call_failed', (failedCallId, reason) => {
            if (failedCallId === callId) {
                console.log(`Звонку хана: ${reason}`);
                process.exit(1);
            }
        });

        setTimeout(() => {
            console.log('90 секунд прошло, все...');
            client.hangup(callId);
            setTimeout(() => {
                client.destroy();
                console.log('SIP сдох');
                process.exit(0);
            }, 2000);
        }, 90000);
        
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

process.on('SIGINT', () => {
    console.log('\nSIGINT');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nSIGTERM');
    process.exit(0);
});

if (require.main === module) {
    main();
}

module.exports = main;