#!/usr/bin/env ts-node
/**
 * TZ-DOC-STUDIO-2001 — measure studio blocks visible to legacy builder filter leak.
 *
 * Counts studio-document blocks whose templateId overlaps template-scoped builder rows.
 * Run against a live MongoDB (same connection as backend).
 *
 * Usage:
 *   pnpm ts-node backend/scripts/tz-doc-studio-2001-dual-read-leak-audit.ts
 *   pnpm ts-node backend/scripts/tz-doc-studio-2001-dual-read-leak-audit.ts --json
 */
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/kppdf?replicaSet=rs0';

async function main(): Promise<void> {
  await mongoose.connect(MONGO_URI);
  const col = mongoose.connection.collection('template_blocks');

  const leakedStudioBlocks = await col
    .aggregate<{ count: number }>([
      { $match: { isActive: { $ne: false }, parentType: 'studio-document', templateId: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'template_blocks',
          let: { tid: '$templateId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$templateId', '$$tid'] },
                    { $in: ['$parentType', ['template', null]] },
                    { $ne: ['$isActive', false] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'builderSibling',
        },
      },
      { $match: { 'builderSibling.0': { $exists: true } } },
      { $count: 'count' },
    ])
    .toArray();

  const distinctLeakedTemplateIds = await col
    .aggregate<{ count: number }>([
      { $match: { isActive: { $ne: false }, parentType: 'studio-document', templateId: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: 'template_blocks',
          let: { tid: '$templateId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$templateId', '$$tid'] },
                    { $in: ['$parentType', ['template', null]] },
                    { $ne: ['$isActive', false] },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: 'builderSibling',
        },
      },
      { $match: { 'builderSibling.0': { $exists: true } } },
      { $group: { _id: '$templateId' } },
      { $count: 'count' },
    ])
    .toArray();

  const report = {
    task: 'TZ-DOC-STUDIO-2001',
    leakedStudioBlockCount: leakedStudioBlocks[0]?.count ?? 0,
    distinctTemplateIdsAffected: distinctLeakedTemplateIds[0]?.count ?? 0,
    note: 'Pre-fix filter would return these studio blocks in legacy builder findAll for shared templateId.',
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('TZ-DOC-STUDIO-2001 dual-read leak audit');
    console.log(`  Leaked studio blocks (would match builder filter): ${report.leakedStudioBlockCount}`);
    console.log(`  Distinct templateIds affected: ${report.distinctTemplateIdsAffected}`);
    console.log(`  ${report.note}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
