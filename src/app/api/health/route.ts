import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// Hardcoded demo patients. This route is not a FHIR or EHR integration.
const DEMO_PATIENTS = [
  { id:'CIQ-00124', name:'Maria T.', age:58, conditions:['T2 Diabetes','Hypertension'], risk:'high', riskScore:87, healthScore:54, gaps:4 },
  { id:'CIQ-00512', name:'James R.', age:44, conditions:['Pre-Diabetes','Obesity'], risk:'medium', riskScore:61, healthScore:63, gaps:4 },
  { id:'CIQ-00389', name:'Rosa L.', age:67, conditions:['COPD','Heart Failure'], risk:'high', riskScore:92, healthScore:41, gaps:4 },
  { id:'CIQ-00741', name:'David K.', age:35, conditions:['Anxiety','Hypertension'], risk:'medium', riskScore:48, healthScore:71, gaps:3 },
  { id:'CIQ-00295', name:'Linda S.', age:52, conditions:['Preventive','Well Visit'], risk:'low', riskScore:22, healthScore:84, gaps:2 },
  { id:'CIQ-00271', name:'Carlos M.', age:61, conditions:['CKD Stage 3','Diabetes'], risk:'high', riskScore:79, healthScore:49, gaps:4 },
  { id:'CIQ-00634', name:'Agnes W.', age:74, conditions:['Osteoporosis','Hypertension'], risk:'medium', riskScore:55, healthScore:66, gaps:4 },
  { id:'CIQ-00887', name:'Tyrone B.', age:29, conditions:['Asthma','Uninsured'], risk:'low', riskScore:18, healthScore:88, gaps:3 },
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const patientId = searchParams.get('id');

  if (patientId) {
    const patient = DEMO_PATIENTS.find(p => p.id === patientId);
    if (!patient) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    return NextResponse.json(patient);
  }

  return NextResponse.json({ patients: DEMO_PATIENTS, total: DEMO_PATIENTS.length });
}
