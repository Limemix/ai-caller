export interface CallRecord {
    id: string;
    date: Date;
    phone: string;
    companyId: string;
    userId: string;
    transcript: string;
    audioUrl?: string;
    comment?: string;
}