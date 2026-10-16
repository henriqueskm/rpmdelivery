import { AuthForm } from "@/features/auth/auth-form";
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ perfil?: string }> }) {
  return <AuthForm mode="signup" courier={(await searchParams).perfil === "motoboy"} />;
}
