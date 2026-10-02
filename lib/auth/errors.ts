export function authMessage(error: { code?: string; message: string }) {
  if (error.code === "invalid_credentials")
    return "E-mail ou senha incorretos. Confira os dados e tente novamente.";
  if (error.code === "email_not_confirmed")
    return "Confirme seu e-mail antes de entrar.";
  if (
    error.code === "over_request_rate_limit" ||
    error.code === "over_email_send_rate_limit"
  )
    return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  if (error.code === "weak_password")
    return "Escolha uma senha mais forte, com pelo menos 8 caracteres.";
  if (error.code === "user_already_exists")
    return "Não foi possível concluir o cadastro. Tente entrar com seu e-mail.";
  return "Não foi possível acessar sua conta agora. Confira a conexão e tente novamente.";
}
