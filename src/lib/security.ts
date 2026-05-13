export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + 'becoartes_salt_2024'); // Salt para segurança extra
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function comparePin(pin: string, hashedPin: string): Promise<boolean> {
  const newHash = await hashPin(pin);
  return newHash === hashedPin;
}
