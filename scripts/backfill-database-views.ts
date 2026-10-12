import {backfillDatabaseViewOrders, pendingDatabaseViewOrderCount}
  from '../src/repositories/page-projection-backfill.js';

const pendingViews = await pendingDatabaseViewOrderCount();
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({pendingViews, apply: false, message: 'Use --apply para importar ordens nesta DATABASE_URL.'}));
} else {
  const views = await backfillDatabaseViewOrders();
  const remainingViews = await pendingDatabaseViewOrderCount();
  console.log(JSON.stringify({views, remainingViews, apply: true}));
  if (remainingViews !== 0) process.exitCode = 1;
}
