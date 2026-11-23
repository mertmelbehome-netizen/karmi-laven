// Import FIRST (before ../api/*.js) in a test file that proves the pools-table behaviour of 23 Nov 2026 (Gradient
// £2.99 1/2/3/5, free from £12 or 5 items). After the M1 go-live ladders.json is in mode cart_qty_groups; these tests
// then keep running against the frozen table (api/_pricing.js honours KL_TEST_LADDERS_FILE only under node --test).
// tests/m1-page.test.mjs checks that this fixture equals ladders.json for as long as ladders.json is the pools table.
process.env.KL_TEST_LADDERS_FILE = 'tests/fixtures/ladders.live-2026-11-23.json'
