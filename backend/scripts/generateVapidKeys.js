// Creates the VAPID key pair that identifies this server to browser push services.
// Run once:  npm run vapid
// Then set the three values on the server (Railway > Variables). Keep the private key secret and keep the
// same pair forever: changing it makes every installed app's subscription stop working until it re-subscribes.
import { generateVapidKeys } from '../src/webpush.js';

const keys = generateVapidKeys();
console.log('Add these to your backend environment variables:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com   # your own contact address\n');
console.log('The public key is safe to share. NEVER put the private key in the website, in git, or in a chat.');
