import { z } from "zod";
import { rawPrisma } from "../db/client";
import { verifyPassword } from "./password";
import { createSessionToken } from "./session";
import { unauthorized } from "../errors";

export const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

/** Password login. The seam where an SSO provider would plug in. */
export async function login(input: unknown) {
  const { email, password } = LoginSchema.parse(input);
  const user = await rawPrisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) throw unauthorized("Email or password is incorrect");
  return { token: await createSessionToken(user.id), user: { id: user.id, name: user.name, role: user.role } };
}
