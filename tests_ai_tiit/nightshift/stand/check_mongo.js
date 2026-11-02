const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI || 'mongodb://mongo:27017/datacore-test')
  .then(() => { console.log('connected'); process.exit(0); })
  .catch(e => { console.log('err', e.message); process.exit(1); });