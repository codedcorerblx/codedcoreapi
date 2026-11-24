import { handleRequest } from "@/lib/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = (req: Request) => handleRequest(req);
export const POST = (req: Request) => handleRequest(req);
export const PUT = (req: Request) => handleRequest(req);
export const PATCH = (req: Request) => handleRequest(req);
export const DELETE = (req: Request) => handleRequest(req);
