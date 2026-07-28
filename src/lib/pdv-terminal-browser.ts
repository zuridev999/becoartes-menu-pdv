export type PdvTerminalIdentity = {
  id: string;
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey;
};

const DB_NAME = 'becoartes-pdv-terminal';
const STORE_NAME = 'identity';
const RECORD_KEY = 'terminal';

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento seguro do terminal.'));
  });
}

async function readIdentity() {
  if (typeof window === 'undefined' || !window.crypto?.subtle || !window.indexedDB) return null;
  const database = await openDatabase();
  return new Promise<PdvTerminalIdentity | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RECORD_KEY);
    request.onsuccess = () => resolve((request.result as PdvTerminalIdentity | undefined) || null);
    request.onerror = () => reject(request.error || new Error('Não foi possível ler a identidade deste terminal.'));
  }).finally(() => database.close());
}

async function writeIdentity(identity: PdvTerminalIdentity) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(identity, RECORD_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Não foi possível salvar a identidade deste terminal.'));
  }).finally(() => database.close());
}

function toBase64Url(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function createPdvTerminalIdentity() {
  const current = await readIdentity();
  if (current) return current;
  if (!window.crypto?.subtle) throw new Error('Este navegador não oferece a proteção necessária para autorizar o terminal.');

  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const identity: PdvTerminalIdentity = {
    id: window.crypto.randomUUID(),
    publicKeyJwk: await window.crypto.subtle.exportKey('jwk', keyPair.publicKey),
    privateKey: keyPair.privateKey,
  };
  await writeIdentity(identity);
  return identity;
}

export async function signPdvTerminalChallenge(identity: PdvTerminalIdentity, challenge: string) {
  const signature = await window.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey,
    new TextEncoder().encode(challenge),
  );
  return toBase64Url(signature);
}
