/** Telefone no formato internacional sem símbolos: apenas dígitos, 10 a 15 caracteres (padrão E.164 sem "+"). */
const PHONE_REGEX = /^\d{10,15}$/;

export function isValidPhone(phone: unknown): phone is string {
  return typeof phone === 'string' && PHONE_REGEX.test(phone);
}
