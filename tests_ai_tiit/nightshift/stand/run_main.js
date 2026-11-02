console.log('start');
try {
  require('./dist/src/main.js');
  console.log('required ok');
} catch (e) {
  console.error('ERROR:', e && e.stack ? e.stack : e);
  process.exit(1);
}