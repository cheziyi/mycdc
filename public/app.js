// src/ecies.ts decrypts the layout this file encrypts to, so change both
// together.

const HKDF_INFO = new TextEncoder().encode('mycdc-ecies-v1');
const VERSION = 0x01;
const IV_LENGTH = 12;
const COPIED_LABEL_DURATION_IN_MS = 2000;

const findElement = (id) => document.getElementById(id);

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

let serverPublicKeyPromise;
function fetchServerPublicKey() {
  serverPublicKeyPromise ??= fetch('/api/pubkey')
    .then((response) => {
      if (!response.ok) throw new Error('pubkey unavailable');
      return response.json();
    })
    .then((body) => decodeBase64Url(body.key));
  return serverPublicKeyPromise;
}

async function encryptCredentials(learnerId, password) {
  const serverPublicKeyBytes = await fetchServerPublicKey();
  const serverPublicKey = await crypto.subtle.importKey(
    'raw',
    serverPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const ephemeralKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const ephemeralPublicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeralKeyPair.publicKey));

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: serverPublicKey },
    ephemeralKeyPair.privateKey,
    256,
  );
  const inputKeyMaterial = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ephemeralPublicKeyBytes, info: HKDF_INFO },
    inputKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(JSON.stringify({ id: learnerId, pw: password }));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ephemeralPublicKeyBytes }, aesKey, plaintext),
  );

  const blob = new Uint8Array(1 + ephemeralPublicKeyBytes.length + iv.length + ciphertext.length);
  blob[0] = VERSION;
  blob.set(ephemeralPublicKeyBytes, 1);
  blob.set(iv, 1 + ephemeralPublicKeyBytes.length);
  blob.set(ciphertext, 1 + ephemeralPublicKeyBytes.length + iv.length);
  return blob;
}

const form = findElement('form');
const status = findElement('status');
const submitButton = findElement('submit');
const result = findElement('result');

function showStatus(message, tone) {
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
}

findElement('toggle').addEventListener('click', (event) => {
  const passwordField = findElement('password');
  const showing = passwordField.type === 'text';
  passwordField.type = showing ? 'password' : 'text';
  event.currentTarget.textContent = showing ? 'Show' : 'Hide';
  event.currentTarget.setAttribute('aria-pressed', String(!showing));
});

findElement('copy').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(findElement('url').value);
  } catch {
    // Older Safari and an insecure context both refuse the clipboard.
    findElement('url').select();
    document.execCommand?.('copy');
  }
  button.textContent = 'Copied';
  button.dataset.done = '1';
  setTimeout(() => {
    button.textContent = 'Copy';
    delete button.dataset.done;
  }, COPIED_LABEL_DURATION_IN_MS);
});

function showResult(calendarUrl, preview) {
  findElement('url').value = calendarUrl;

  // iOS and macOS open a webcal: link in Calendar's subscription dialog.
  const webcalUrl = calendarUrl.replace(/^https?:/, 'webcal:');
  findElement('ios').href = webcalUrl;
  findElement('gcal').href = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcalUrl);

  const count = preview.count;
  findElement('found').textContent =
    count === 0
      ? 'That worked. ComfortDelGro Driving Centre accepted your details. You have no bookings right now, so your calendar starts empty and fills up as you book.'
      : `That worked. ComfortDelGro Driving Centre accepted your details, and you have ${count} ${count === 1 ? 'booking' : 'bookings'}.`;

  const list = findElement('upcoming');
  list.replaceChildren();
  for (const event of preview.events) {
    const item = document.createElement('li');
    const summary = document.createElement('span');
    summary.textContent = event.summary;
    const time = document.createElement('span');
    time.className = 'when';
    time.textContent = `${event.date}, ${event.time}`;
    item.append(summary, time);
    list.append(item);
  }
  list.hidden = preview.events.length === 0;

  result.hidden = false;
  result.dataset.enter = '1';
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const learnerId = findElement('learner').value.trim();
  const password = findElement('password').value;
  if (!learnerId || !password) {
    showStatus('Please enter your learner ID and password.', 'error');
    return;
  }

  submitButton.disabled = true;
  result.hidden = true;
  delete result.dataset.enter;
  showStatus('Encrypted. Now asking ComfortDelGro Driving Centre what you have booked. This takes a few seconds.');

  try {
    const credentials = encodeBase64Url(await encryptCredentials(learnerId, password));
    const response = await fetch(`/api/preview?creds=${credentials}`);
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body.ok) {
      showStatus(
        body.error || `Couldn't reach ComfortDelGro Driving Centre (HTTP ${response.status}). Please try again in a moment.`,
        'error',
      );
      return;
    }

    showStatus('');
    showResult(`${location.origin}/calendar.ics?creds=${credentials}`, body);
  } catch (error) {
    console.error(error);
    showStatus("Couldn't create the link in this browser. Please check your connection and try again.", 'error');
  } finally {
    submitButton.disabled = false;
  }
});
