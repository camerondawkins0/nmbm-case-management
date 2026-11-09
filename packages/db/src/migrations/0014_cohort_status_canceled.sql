-- North American spelling throughout the app, including stored values:
-- the cohort status 'cancelled' becomes 'canceled'. A rename, not a new
-- value, so rows keep their meaning. Safe while old code is still
-- running during a deploy: nothing writes this status (there's no
-- screen that cancels a cohort), and the one place that reads it only
-- compares, so old code just never sees a match.
ALTER TYPE "cohort_status" RENAME VALUE 'cancelled' TO 'canceled';
