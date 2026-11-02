import { handleDemoHttp } from "@/lib/clinic/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleDemoHttp(req);
}

export async function POST(req: Request) {
  return handleDemoHttp(req);
}

export async function PUT(req: Request) {
  return handleDemoHttp(req);
}

export async function PATCH(req: Request) {
  return handleDemoHttp(req);
}

export async function DELETE(req: Request) {
  return handleDemoHttp(req);
}
