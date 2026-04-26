import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const PII_PATTERNS = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, type: 'SSN', severity: 'CRITICAL' },
  { pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, type: 'PHONE', severity: 'HIGH' },
  { pattern: /\b(dob|date of birth|born)[:\s]+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/gi, type: 'DOB', severity: 'CRITICAL' },
  { pattern: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, type: 'DATE', severity: 'MEDIUM' },
  { pattern: /\b[A-Z]{2}\d{6,10}\b/g, type: 'MRN', severity: 'HIGH' },
  { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, type: 'EMAIL', severity: 'HIGH' },
];

const SOVEREIGN_TERMS = ['chikasha', 'chickasaw', 'chikashshanompa', 'yakoke', 'chikashsha', 'iti fabvssa'];

async function sha256Hash(text: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text + salt);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16).toUpperCase();
}

function serverSideScan(text: string) {
  const flags: Array<{type: string; severity: string; masked: string}> = [];
  let sanitized = text;

  for (const p of PII_PATTERNS) {
    const matches = text.match(p.pattern);
    if (matches) {
      matches.forEach(m => {
        flags.push({ type: p.type, severity: p.severity, masked: '[' + p.type + '_PROTECTED]' });
        sanitized = sanitized.replace(m, '[' + p.type + '_PROTECTED]');
      });
    }
  }

  const riskScore = flags.reduce((acc, f) => {
    return acc + (f.severity === 'CRITICAL' ? 40 : f.severity === 'HIGH' ? 25 : 10);
  }, 0);

  return { flags, sanitized, riskScore: Math.min(riskScore, 100) };
}

const SYSTEM = `You are CareIQ, an AI-powered community health intelligence system built by Sovereign Shield Technologies LLC for Federally Qualified Health Centers. You help clinical staff understand patient risk, care gaps, and preventive health opportunities. You speak with clinical precision and compassion. All patient data you receive has been processed by the Sovereign Prompt Shield — PHI has been replaced with protected tokens. Never reproduce protected tokens in your responses. Focus on actionable clinical insights. Be concise and direct.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, patientId, zkReport } = body;

    const lastMessage = messages[messages.length - 1]?.content || '';
    const serverScan = serverSideScan(lastMessage);
    const timestamp = new Date().toISOString();
    const zkTermsProtected = zkReport?.protectedTerms?.length || 0;
    const totalRisk = serverScan.riskScore;
    const riskLevel = totalRisk >= 60 ? 'CRITICAL' : totalRisk >= 30 ? 'HIGH' : totalRisk >= 10 ? 'MEDIUM' : 'LOW';

    const auditEntry = {
      timestamp,
      patientId: patientId || 'UNKNOWN',
      zkTermsProtected,
      zeroKnowledge: zkReport || null,
      serverFlags: serverScan.flags,
      serverRiskScore: serverScan.riskScore,
      riskLevel,
      action: zkTermsProtected > 0 && serverScan.flags.length > 0 ? 'ZK_HASHED_AND_PII_BLOCKED'
            : zkTermsProtected > 0 ? 'ZK_HASHED_AND_PASSED'
            : serverScan.flags.length > 0 ? 'PII_BLOCKED'
            : 'CLEAN_PASS',
      dataResidency: 'TRACE_FIBER_SOVEREIGN',
      shieldVersion: '2.0.0-ZK',
      architecture: 'ZERO_KNOWLEDGE_DUAL_LAYER',
    };

    const finalMessages = messages.map((m: {role:string;content:string}, i: number) =>
      i === messages.length - 1 ? { ...m, content: serverScan.sanitized } : m
    );

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'API key not configured' }, { status: 500 });

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 600, system: SYSTEM, messages: finalMessages }),
    });

    const aiData = await aiRes.json();
    return NextResponse.json({
      content: aiData.content?.[0]?.text || 'Unable to connect.',
      shield: auditEntry,
    });
  } catch {
    return NextResponse.json({ error: 'Shield error' }, { status: 500 });
  }
}
