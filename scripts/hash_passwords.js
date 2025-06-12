const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const saltRounds = 10;
const plainPasswords = ['dokter123', 'pasien123'];

console.log('Generating password hashes...');

Promise.all(plainPasswords.map(p => bcrypt.hash(p, saltRounds)))
  .then(hashes => {
    console.log('dokter123 ->', hashes[0]);
    console.log('pasien123 ->', hashes[1]);
    console.log('\nCopy these hashes into your users.json file.');
  });