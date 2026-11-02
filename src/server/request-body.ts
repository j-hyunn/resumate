import { AppError } from "@/lib/contracts/errors";

/** JSON body, or `{}` for an empty body. Malformed JSON → 400 `invalid_input`. */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("invalid_input");
  }
}
