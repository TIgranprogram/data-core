const mongoose = require('mongoose');
mongoose.connect('mongodb://mongo:27017/datacore-test', { serverSelectionTimeoutMS: 5000 })
  .then(() => { console.log('ok'); process.exit(0); })
  .catch(e => { console.log('err', e.message); process.exit(1); });