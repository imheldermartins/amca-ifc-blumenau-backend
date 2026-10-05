import {backfillDatabaseValueProjections, backfillDatabaseViewOrders, pendingDatabaseProjectionCounts}
  from '../src/repositories/page-projection-backfill.js';

const pending = await pendingDatabaseProjectionCounts();
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({pending, apply: false, message: 'Use --apply para importar as projeções e ordens nesta DATABASE_URL.'}));
} else {
  const values = await backfillDatabaseValueProjections();
  const views = await backfillDatabaseViewOrders();
  const remaining = await pendingDatabaseProjectionCounts();
  console.log(JSON.stringify({values, views, remaining, apply: true}));
  if (Object.values(remaining).some((total) => total !== 0)) process.exitCode = 1;
}
