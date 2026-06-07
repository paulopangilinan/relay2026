// seed-superadmin.js
// Run: node seed-superadmin.js
// Then paste the generated SQL into Supabase SQL editor.

import bcrypt from 'bcryptjs';

const DEFAULT_PASSWORD = 'Relay2026!';
const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

console.log('\n✅ Super admin seed SQL — paste into Supabase SQL editor:\n');
console.log(`INSERT INTO admins (email, name, password_hash, permissions, is_super_admin, force_password_change)`);
console.log(`VALUES (`);
console.log(`  'paulopangilinan@gmail.com',`);
console.log(`  'Paulo Pangilinan',`);
console.log(`  '${hash}',`);
console.log(`  '{"receive_updates":true,"verify_payment":true,"manage_admins":true,"manage_churches":true}',`);
console.log(`  true,`);
console.log(`  true`);
console.log(`);\n`);
console.log(`Default password: ${DEFAULT_PASSWORD}`);
console.log('(User will be forced to change this on first login)\n');
