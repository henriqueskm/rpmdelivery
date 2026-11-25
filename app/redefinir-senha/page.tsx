import type { Metadata } from "next";
import { PasswordReset } from "@/features/auth/password-reset";

export const metadata: Metadata = {
  title: "Esqueci a senha | RpmDelivery",
  description: "Peça um link para criar uma senha nova na sua conta do RpmDelivery.",
};

// Opened from the courier app ("Esqueci a senha"), from the panel login and from the e-mail link.
export default function PasswordResetPage() {
  return <PasswordReset />;
}
