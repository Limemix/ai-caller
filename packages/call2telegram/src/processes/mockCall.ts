export async function mockCall(phoneNumber: string, companyId: string, comment: string) {
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  const isClientBusy = Math.random() > 0.5;
  
  if (isClientBusy) {
    return {
      type: 'callResult',
      transcript: 'CLIENT_BUSY',
      comment: 'Client did not answer',
    };
  }
  
  return {
    type: 'callResult',
    transcript: 'Mock call completed successfully. Client interested.',
    comment: 'Call completed',
    audioUrl: undefined,
  };
}


