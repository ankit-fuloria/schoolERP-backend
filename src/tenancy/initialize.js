const platform = require('./platform');
const { fingerprint } = require('./connections');
async function initialize() {
  const { School, Branch } = await platform.connect();
  if (platform.connection().name === require('mongoose').connection.name) {
    throw new Error('OWNER_DB_NAME must be different from the existing school database name');
  }
  const school = await School.findOneAndUpdate({ code: 'legacy' }, { $setOnInsert: { name: 'Existing School' } }, { upsert: true, new: true });
  await Branch.findOneAndUpdate({ schoolId: school._id, code: 'main' }, {
    $setOnInsert: { name: 'Main Branch', legacy: true },
    $set: { databaseKey: await fingerprint(require('mongoose').connection) },
  }, { upsert: true, new: true });
  for (const item of await School.find().select('_id')) {
    if (!await Branch.exists({ schoolId: item._id, isMain: true })) {
      const first = await Branch.findOne({ schoolId: item._id }).sort({ createdAt: 1, _id: 1 });
      if (first) await Branch.updateOne({ _id: first._id }, { $set: { isMain: true } });
    }
  }
}
module.exports = initialize;
