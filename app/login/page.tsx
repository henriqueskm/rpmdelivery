import { AuthForm } from "@/features/auth/auth-form";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ perfil?: string }> }) {
  return <AuthForm mode="login" courier={(await searchParams).perfil === "motoboy"} />;
}
