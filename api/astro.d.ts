import type { IncomingMessage, ServerResponse } from 'node:http';

export declare const UPSTREAMS: Record<'exo' | 'sbdb' | 'horizons', string>;
export declare function fetchUpstream(src: string | null, query: string | null, fetchImpl?: typeof fetch): Promise<{ status: number; type: string; body: string }>;
export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void>;
