-- Reset all AI classifications to test from scratch

-- Clear the many-to-many mapping table
DELETE FROM feedback_match;

-- Clear all aggregated feedbacks
DELETE FROM feedback_aggregated;

-- Reset is_actionable flag to NULL (unprocessed) for all feedback events
UPDATE feedback_events SET is_actionable = NULL;

-- Reset AUTOINCREMENT sequences for cosmetic cleanliness
DELETE FROM sqlite_sequence WHERE name IN ('feedback_aggregated', 'feedback_match');

-- Verify counts
SELECT 'Feedback events (all should be unprocessed):' as status, COUNT(*) as count FROM feedback_events WHERE is_actionable IS NULL;
SELECT 'Aggregated feedbacks (should be 0):' as status, COUNT(*) as count FROM feedback_aggregated;
SELECT 'Feedback matches (should be 0):' as status, COUNT(*) as count FROM feedback_match;
