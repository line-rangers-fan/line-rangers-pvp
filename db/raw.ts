import { env } from 'cloudflare:workers';
export function database(){if(!env.DB)throw new Error('storage_unavailable');return env.DB;}
export function bucket(){const value=(env as unknown as {BUCKET?:R2Bucket}).BUCKET;if(!value)throw new Error('storage_unavailable');return value;}
